from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import os
import base64
import uuid
from io import BytesIO
from datetime import datetime
from PIL import Image
import pi_heif
from supabase import create_client, Client
from dotenv import load_dotenv
from pywebpush import webpush, WebPushException
import json
import threading

# Loads a local ".env" file if present
load_dotenv()

# Register HEIF opener with Pillow to support HEIC files natively
pi_heif.register_heif_opener()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Secrets & config
# ---------------------------------------------------------------------------
app.secret_key = os.environ["SECRET_KEY"]
NA_LOGIN_PASSWORD = os.environ["NA_LOGIN_PASSWORD"]
LU_LOGIN_PASSWORD = os.environ["LU_LOGIN_PASSWORD"]
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB limitL

# ---------------------------------------------------------------------------
# Supabase client (Now used for BOTH Database and Storage!)
# ---------------------------------------------------------------------------
supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)
STORAGE_BUCKET = os.environ.get("SUPABASE_BUCKET", "images")

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "heic"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def is_logged_in():
    return session.get("logged_in", False)


def process_and_upload_image(file):
    """
    Sanitizes and processes an image upload, converts HEIC to JPG,
    generates a tiny base64 LQIP, and uploads the final JPEG straight
    to Supabase Storage (no local filesystem involved).

    Returns (public_url, storage_path, lqip_str).
    """
    original_name = file.filename
    is_heic = original_name.rsplit(".", 1)[1].lower() == "heic"
    ext = "jpg" if is_heic else original_name.rsplit(".", 1)[1].lower()

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    unique_name = f"{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"

    lqip_str = None
    try:
        img = Image.open(file.stream)

        # Encode the primary image as an optimized JPEG in memory
        main_buffer = BytesIO()
        img.convert("RGB").save(main_buffer, "JPEG", quality=85)
        main_bytes = main_buffer.getvalue()

        # Generate Low Quality Image Placeholder (LQIP)
        lqip_img = img.copy()
        lqip_img.thumbnail((20, 20))
        lqip_buffer = BytesIO()
        lqip_img.convert("RGB").save(lqip_buffer, format="JPEG", quality=20)
        lqip_str = "data:image/jpeg;base64," + base64.b64encode(
            lqip_buffer.getvalue()
        ).decode("utf-8")
    except Exception as e:
        # Fallback: upload the raw stream unmodified if Pillow processing fails
        file.seek(0)
        main_bytes = file.read()
        app.logger.error(f"Image processing failed, uploading raw file. Error: {e}")

    storage_path = unique_name
    supabase.storage.from_(STORAGE_BUCKET).upload(
        storage_path,
        main_bytes,
        {"content-type": "image/jpeg"},
    )
    public_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)

    return public_url, storage_path, lqip_str


def delete_image_from_storage(storage_path):
    if not storage_path:
        return
    try:
        supabase.storage.from_(STORAGE_BUCKET).remove([storage_path])
    except Exception as e:
        app.logger.error(f"Error removing image from storage: {e}")

@app.route("/sw.js")
def serve_sw():
    return app.send_static_file("js/sw.js")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        password = request.form["password"]
        user = request.form.get("user", None)
        if (user == "nathan" and password == NA_LOGIN_PASSWORD) or (user == "luisa" and password == LU_LOGIN_PASSWORD):
            session["logged_in"] = True
            session["user"] = user
            return redirect(url_for("index"))
        else:
            return render_template("login.html", error="Ungültige Anmeldedaten. Bitte versuche es erneut.")
    return render_template("login.html")


@app.route("/api/entries")
def get_entries():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    limit = request.args.get("limit", type=int)

    # Fetch entries from Supabase via API API-Client
    try:
        query = supabase.table("journal_entry").select("*").order("created_at", desc=True)
        if limit:
            query = query.limit(limit)
        
        response = query.execute()
        entries_list = response.data
    except Exception as e:
        app.logger.error(f"Database fetch failed: {e}")
        entries_list = []

    return jsonify({"entries": entries_list})


@app.route("/")
def index():
    if not is_logged_in():
        return redirect(url_for("login"))
    return render_template("index.html")


@app.route("/gallery")
def gallery():
    if not is_logged_in():
        return redirect(url_for("login"))
    return render_template("gallery.html")


def get_other_user(username):
    if username == "nathan":
        return "luisa"
    if username == "luisa":
        return "nathan"
    return None


@app.route("/add_entry", methods=["POST"])
def add_entry():
    if not is_logged_in():
        return redirect(url_for("login"))

    title = request.form.get("title")
    text = request.form.get("text")
    date = request.form.get("date")

    if not date:
        date = datetime.now().strftime("%Y-%m-%d")

    image_url = None
    storage_path = None
    img_placeholder_str = None

    if "media" in request.files:
        file = request.files["media"]
        if file and file.filename and allowed_file(file.filename):
            image_url, storage_path, img_placeholder_str = process_and_upload_image(file)

    # Save to database using Supabase API insert
    try:
        supabase.table("journal_entry").insert({
            "title": title,
            "text": text,
            "date": date,
            "image_url": image_url,
            "storage_path": storage_path,
            "img_placeholder_str": img_placeholder_str
        }).execute()
        threading.Thread(
            target=send_push_notifications,
            args=("Memorybook", "Hey, es gibt eine neue Erinnerung! 💕"),
            kwargs={"url_path": "/gallery"},
            daemon=True,
        ).start()
    except Exception as e:
        app.logger.error(f"Failed to insert entry: {e}")

    return redirect(request.referrer or url_for("gallery"))


@app.route("/edit_entry/<int:entry_id>", methods=["POST"])
def edit_entry(entry_id):
    if not is_logged_in():
        return redirect(url_for("login"))

    # Fetch the old entry first to manage image changes
    try:
        res = supabase.table("journal_entry").select("*").eq("id", entry_id).execute()
        if not res.data:
            return "Entry not found", 404
        entry = res.data[0]
    except Exception as e:
        app.logger.error(f"Failed to fetch entry for edit: {e}")
        return "Database error", 500

    title = request.form.get("title")
    text = request.form.get("text")
    date = request.form.get("date")

    update_data = {
        "title": title,
        "text": text,
    }
    if date:
        update_data["date"] = date

    if "media" in request.files:
        file = request.files["media"]
        if file and file.filename and allowed_file(file.filename):
            # Clean up old image in Supabase Storage
            delete_image_from_storage(entry.get("storage_path"))

            image_url, storage_path, img_placeholder_str = process_and_upload_image(file)
            update_data["image_url"] = image_url
            update_data["storage_path"] = storage_path
            update_data["img_placeholder_str"] = img_placeholder_str

    try:
        supabase.table("journal_entry").update(update_data).eq("id", entry_id).execute()
    except Exception as e:
        app.logger.error(f"Failed to update entry: {e}")

    return redirect(request.referrer or url_for("gallery"))

@app.route("/ping")
def ping():
    return "OK", 200


@app.route("/delete_entry/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    if not is_logged_in():
        return jsonify({"success": False, "error": "Unauthorized"}), 401

    try:
        res = supabase.table("journal_entry").select("storage_path").eq("id", entry_id).execute()
        if res.data:
            delete_image_from_storage(res.data[0].get("storage_path"))
        
        supabase.table("journal_entry").delete().eq("id", entry_id).execute()
    except Exception as e:
        app.logger.error(f"Failed to delete entry: {e}")
        return jsonify({"success": False, "error": "Database error"}), 500

    return jsonify({"success": True})

@app.route("/api/subscribe", methods=["POST"])
def subscribe():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    subscription_data = payload.get("subscription") or payload
    current_user = session.get("user") or payload.get("user")

    if not subscription_data:
        return jsonify({"error": "Invalid subscription data"}), 400
    if not current_user:
        return jsonify({"error": "Missing user"}), 400

    endpoint = subscription_data.get("endpoint")
    if not endpoint:
        return jsonify({"error": "Invalid subscription endpoint"}), 400

    try:
        res = supabase.table("push_subscriptions").select("id").eq("endpoint", endpoint).execute()

        if res.data:
            supabase.table("push_subscriptions").update({
                "user": current_user,
                "subscription_data": subscription_data
            }).eq("endpoint", endpoint).execute()
        else:
            supabase.table("push_subscriptions").insert({
                "user": current_user,
                "endpoint": endpoint,
                "subscription_data": subscription_data
            }).execute()
        
        return jsonify({"success": True})
    except Exception as e:
        app.logger.error(f"Failed to save subscription: {e}")
        return jsonify({"error": "Database error"}), 500
    
def send_push_notifications(title, message, url_path="/gallery"):
    try:
        # Hole alle aktiven Abos aus der Datenbank
        res = supabase.table("push_subscriptions").select("*").execute()
        subscriptions = res.data or []
    except Exception as e:
        app.logger.error(f"Failed to fetch subscriptions for push: {e}")
        return

    vapid_private = os.environ["VAPID_PRIVATE_KEY"]

    # Web Push erwartet bei "sub" eine mailto:-Adresse.
    vapid_contact = os.environ.get("VAPID_MAILTO", "").strip().strip('"').strip("'")
    if not vapid_contact:
        app.logger.error("VAPID_MAILTO is missing; cannot send push notifications.")
        return
    if not vapid_contact.startswith("mailto:"):
        vapid_contact = f"mailto:{vapid_contact}"

    vapid_claims = {"sub": vapid_contact}

    payload = json.dumps({
        "title": title,
        "body": message,
        "url": url_path
    })

    seen_endpoints = set()
    for sub in subscriptions:
        sub_data = sub.get("subscription_data")
        endpoint = (sub_data or {}).get("endpoint")
        if not endpoint or endpoint in seen_endpoints:
            continue
        seen_endpoints.add(endpoint)
        try:
            webpush(
                subscription_info=sub_data,
                data=payload,
                vapid_private_key=vapid_private,
                vapid_claims=vapid_claims
            )
        except WebPushException as ex:
            app.logger.error(f"WebPush error: {ex}")
            # Falls das Abo abgelaufen/ungültig ist (z.B. App deinstalliert), aus DB löschen
            if ex.response and ex.response.status_code in [410, 404]:
                supabase.table("push_subscriptions").delete().eq("id", sub.get("id")).execute()
        except Exception as e:
            app.logger.error(f"Unexpected push error: {e}")


def send_push_notifications_to_user(username, title, message, url_path="/gallery"):
    try:
        res = supabase.table("push_subscriptions").select("*").eq("user", username).execute()
        subscriptions = res.data or []
    except Exception as e:
        app.logger.error(f"Failed to fetch user subscriptions for push: {e}")
        return

    vapid_private = os.environ["VAPID_PRIVATE_KEY"]
    vapid_contact = os.environ.get("VAPID_MAILTO", "").strip().strip('"').strip("'")
    if not vapid_contact:
        app.logger.error("VAPID_MAILTO is missing; cannot send push notifications.")
        return
    if not vapid_contact.startswith("mailto:"):
        vapid_contact = f"mailto:{vapid_contact}"

    vapid_claims = {"sub": vapid_contact}
    payload = json.dumps({
        "title": title,
        "body": message,
        "url": url_path
    })

    seen_endpoints = set()
    for sub in subscriptions:
        sub_data = sub.get("subscription_data")
        endpoint = (sub_data or {}).get("endpoint")
        if not endpoint or endpoint in seen_endpoints:
            continue
        seen_endpoints.add(endpoint)
        try:
            webpush(
                subscription_info=sub_data,
                data=payload,
                vapid_private_key=vapid_private,
                vapid_claims=vapid_claims
            )
        except WebPushException as ex:
            app.logger.error(f"WebPush error: {ex}")
            if ex.response and ex.response.status_code in [410, 404]:
                supabase.table("push_subscriptions").delete().eq("id", sub.get("id")).execute()
        except Exception as e:
            app.logger.error(f"Unexpected push error: {e}")


@app.route("/api/remind/<int:entry_id>", methods=["POST"])
def remind_entry(entry_id):
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user = session.get("user")
    target_user = get_other_user(current_user)
    if not target_user:
        return jsonify({"error": "Unknown user"}), 400

    payload = request.get_json(silent=True) or {}
    custom_message = (payload.get("message") or "").strip()

    try:
        res = supabase.table("journal_entry").select("*").eq("id", entry_id).execute()
        if not res.data:
            return jsonify({"error": "Entry not found"}), 404
        entry = res.data[0]
    except Exception as e:
        app.logger.error(f"Failed to fetch entry for reminder: {e}")
        return jsonify({"error": "Database error"}), 500

    title = f"{current_user.capitalize()} erinnert dich an einen Moment"
    body = custom_message if custom_message else f"Schau dir diesen Moment an: {entry.get('title', 'Erinnerung')}"
    entry_url = f"/gallery?id={entry_id}"

    threading.Thread(
        target=send_push_notifications_to_user,
        args=(target_user, title, body, entry_url),
        daemon=True,
    ).start()

    return jsonify({"success": True})


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------
ERROR_MESSAGES = {
    400: ("Ungültige Anfrage", "Da ist wohl etwas durcheinandergeraten. Versuch es bitte nochmal."),
    401: ("Nicht angemeldet", "Bitte melde dich zuerst an, um diese Seite zu sehen."),
    403: ("Kein Zutritt", "Du hast leider keinen Zugriff auf diesen Bereich."),
    404: ("Seite nicht gefunden", "Diese Erinnerung scheint es nicht (mehr) zu geben."),
    413: ("Datei zu groß", "Das hochgeladene Foto ist leider größer als die erlaubten 16 MB. Bitte verkleinere es und versuche es erneut."),
    429: ("Zu viele Versuche", "Bitte warte einen Moment, bevor du es erneut versuchst."),
    500: ("Serverfehler", "Etwas ist bei uns schiefgelaufen. Bitte versuch es später nochmal."),
    503: ("Kurz nicht erreichbar", "Der Dienst ist gerade nicht verfügbar. Versuch es gleich nochmal."),
}


def handle_error(code):
    """Renders error.html for normal requests, JSON for /api/ requests."""
    title, desc = ERROR_MESSAGES.get(code, ("Unbekannter Fehler", "Etwas ist schiefgelaufen."))

    if request.path.startswith("/api/"):
        return jsonify({"error": title, "detail": desc}), code

    return (
        render_template(
            "error.html",
            error_code=code,
            error_title=title,
            error_desc=desc,
        ),
        code,
    )


@app.errorhandler(400)
def bad_request(e):
    return handle_error(400)


@app.errorhandler(401)
def unauthorized(e):
    return handle_error(401)


@app.errorhandler(403)
def forbidden(e):
    return handle_error(403)


@app.errorhandler(404)
def not_found(e):
    return handle_error(404)


@app.errorhandler(413)
def request_entity_too_large(e):
    """Graceful error handler for files exceeding the 16MB limit."""
    return handle_error(413)


@app.errorhandler(429)
def too_many_requests(e):
    return handle_error(429)


@app.errorhandler(500)
def server_error(e):
    return handle_error(500)


@app.errorhandler(503)
def service_unavailable(e):
    return handle_error(503)


@app.errorhandler(Exception)
def unhandled_exception(e):
    """Catch-all for anything not explicitly handled above, so users never see a raw traceback."""
    app.logger.error(f"Unhandled exception: {e}")
    return handle_error(500)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0")
