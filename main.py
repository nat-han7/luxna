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

# Loads a local ".env" file if present
load_dotenv()

# Register HEIF opener with Pillow to support HEIC files natively
pi_heif.register_heif_opener()

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Secrets & config
# ---------------------------------------------------------------------------
app.secret_key = os.environ["SECRET_KEY"]
LOGIN_PASSWORD = os.environ["LOGIN_PASSWORD"]
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB limit

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


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        password = request.form["password"]
        if password == LOGIN_PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("index"))
        else:
            return render_template("login.html", error="Ungültiger Code")
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


@app.errorhandler(413)
def request_entity_too_large(error):
    """Graceful error handler for files exceeding the 16MB limit."""
    if request.path.startswith("/api/"):
        return jsonify({"error": "Die Datei ist zu groß (max. 16MB)."}), 413
    return (
        render_template(
            "error.html",
            error_title="Datei zu groß",
            error_desc="Das hochgeladene Foto ist leider größer als die erlaubten 16 MB. Bitte verkleinere es und versuche es erneut.",
        ),
        413,
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0")