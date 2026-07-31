from flask import Flask, render_template, request, redirect, url_for, session, jsonify, abort
import os
import base64
import uuid
from io import BytesIO
from datetime import datetime
from datetime import timedelta
from functools import wraps
from PIL import Image
import pi_heif
from supabase import create_client, Client
from dotenv import load_dotenv
from pywebpush import webpush, WebPushException
import json
import threading
from urllib.parse import urlparse
import time
from utils.time_helpers import time_ago

import hashlib
import re
from datetime import date

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash

# Schlüsselwörter, die auf besonders emotionale/bedeutsame Einträge hindeuten
EMOTIONAL_KEYWORDS = [
    "liebe", "geliebt", "immer", "für immer", "glücklich", "glück",
    "das erste mal", "premiere", "meilenstein", "jahrestag", "verlobt",
    "heirat", "vermisse", "vermisst", "wunderschön", "unglaublich",
    "perfekt", "magisch", "besonders", "unvergesslich", "danke",
    "dankbar", "stolz", "geschafft", "endlich"
]

EMOJI_PATTERN = re.compile(r'[\U0001F300-\U0001FAFF\u2600-\u27BF]')

# Loads a local ".env" file if present
load_dotenv()

# Register HEIF opener with Pillow to support HEIC files natively
pi_heif.register_heif_opener()

app = Flask(__name__)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=90)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Cookie darf nur über HTTPS übertragen werden (Render nutzt immer HTTPS).
# Lokal mit "flask run" ohne HTTPS ggf. auf False setzen, sonst funktioniert Login nicht.
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") != "development"

# ---------------------------------------------------------------------------
# Secrets & config
# ---------------------------------------------------------------------------
app.secret_key = os.environ["SECRET_KEY"]
# Wichtig: Diese Variablen enthalten jetzt gehashte Passwörter (werkzeug
# generate_password_hash), keine Klartext-Passwörter mehr! Siehe
# generate_password_hash.py, um die Hashes zu erzeugen und in Render/​.env
# einzutragen.
NA_LOGIN_PASSWORD_HASH = os.environ["NA_LOGIN_PASSWORD_HASH"]
LU_LOGIN_PASSWORD_HASH = os.environ["LU_LOGIN_PASSWORD_HASH"]
# Separates Admin-Passwort fürs /admin-Panel. Nur zusammen mit user="nathan"
# gültig - siehe admin_login(). Genau wie die anderen: Hash, kein Klartext.
ADMIN_PASSWORD_HASH = os.environ["ADMIN_PASSWORD_HASH"]
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB limitL
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()

# ---------------------------------------------------------------------------
# Supabase client (Now used for BOTH Database and Storage!)
# ---------------------------------------------------------------------------
supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)
STORAGE_BUCKET = os.environ.get("SUPABASE_BUCKET", "images")

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "heic"}

# ---------------------------------------------------------------------------
# Rate limiting (v.a. gegen Brute-Force auf /login)
# ---------------------------------------------------------------------------
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],  # nur dort limitieren, wo explizit @limiter.limit(...) steht
    storage_uri="memory://",  # reicht für eine Zwei-Personen-App auf einer Instanz
)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def is_logged_in():
    return session.get("logged_in", False)


def is_admin():
    # Doppelt geprüft: sowohl das Admin-Flag als auch dass es wirklich Nathans
    # Session ist (falls sich jemals jemand anderes als "nathan" einloggen könnte).
    return bool(session.get("is_admin")) and session.get("user") == "nathan"


def admin_required(view):
    """
    Schützt Admin-Routen. Ohne gültige Admin-Session gibt es einen 404 -
    absichtlich KEIN 401/403, damit die Existenz des Panels nach außen nicht
    erkennbar ist (sieht aus wie jede andere nicht existierende Seite).
    """
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            abort(404)
        return view(*args, **kwargs)
    return wrapped


# ---------------------------------------------------------------------------
# Wartungsmodus - Zustand liegt in Supabase (app_settings), damit er Neustarts
# der App übersteht. Tabelle muss einmalig angelegt werden, siehe README-Hinweis.
# ---------------------------------------------------------------------------
DEFAULT_MAINTENANCE_MESSAGE = "Wir sind gerade kurz mit Wartungsarbeiten beschäftigt. Schau gleich nochmal vorbei! 💕"


def get_maintenance_state():
    """Liest (enabled, message) in einem Rutsch aus app_settings."""
    enabled = False
    message = DEFAULT_MAINTENANCE_MESSAGE
    try:
        res = (
            supabase.table("app_settings")
            .select("key, value")
            .in_("key", ["maintenance_mode", "maintenance_message"])
            .execute()
        )
        data = {row["key"]: row["value"] for row in (res.data or [])}
        enabled = data.get("maintenance_mode") == "true"
        if data.get("maintenance_message"):
            message = data["maintenance_message"]
    except Exception as e:
        # Falls die Tabelle fehlt oder Supabase kurz nicht erreichbar ist:
        # sicherheitshalber NICHT die ganze Seite blockieren.
        print(f"Failed to read maintenance state: {e}")
        app.logger.error(f"Failed to read maintenance state: {e}")
    print(f"Maintenance mode: {'enabled' if enabled else 'disabled'}, message: {message}")
    return enabled, message


def set_maintenance_state(enabled, message):
    supabase.table("app_settings").upsert({
        "key": "maintenance_mode",
        "value": "true" if enabled else "false",
    }).execute()
    supabase.table("app_settings").upsert({
        "key": "maintenance_message",
        "value": message or DEFAULT_MAINTENANCE_MESSAGE,
    }).execute()


MAINTENANCE_EXEMPT_PREFIXES = ("/admin", "/static", "/ping", "/sw.js")


@app.before_request
def maintenance_gate():
    print(f"Checking maintenance mode for path: {request.path}")
    # Admin (Nathan, eingeloggt im Panel) umgeht den Wartungsmodus immer -
    # das ist das "sudo" für den Rest der Seite.
    if is_admin():
        print("Admin user detected, bypassing maintenance mode.")
        return
    if request.path.startswith(MAINTENANCE_EXEMPT_PREFIXES):
        return

    enabled, message = get_maintenance_state()
    if enabled:
        print(f"Maintenance mode active. Showing maintenance page with message: {message}")
        return render_template("maintenance.html", message=message), 503


@app.context_processor
def inject_push_config():
    return {"vapid_public_key": VAPID_PUBLIC_KEY}


@app.before_request
def keep_session_alive():
    if session.get("logged_in"):
        session.permanent = True
        session.modified = True


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
        # Sicherheitsfix: Wenn Pillow die Datei nicht als echtes Bild lesen kann,
        # NICHT mehr ungeprüft hochladen (vorher: raw bytes mit "image/jpeg"-Header
        # in den Storage geschoben, obwohl der Inhalt gar kein validiertes Bild war).
        # Stattdessen Upload sauber abbrechen, Aufrufer muss das behandeln.
        app.logger.error(f"Image processing failed, rejecting upload. Error: {e}")
        return None, None, None

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
@limiter.limit("5 per 15 minutes", methods=["POST"])
def login():
    if request.method == "POST":
        password = request.form.get("password", "")
        user = request.form.get("user", None)

        # check_password_hash vergleicht gegen den gespeicherten Hash (PBKDF2/scrypt,
        # je nach werkzeug-Version) und ist selbst schon timing-safe. Das Klartext-
        # Passwort landet damit nie mehr im Vergleich mit einem anderen Klartext.
        valid_nathan = user == "nathan" and check_password_hash(NA_LOGIN_PASSWORD_HASH, password)
        valid_luisa = user == "luisa" and check_password_hash(LU_LOGIN_PASSWORD_HASH, password)

        if valid_nathan or valid_luisa:
            session["logged_in"] = True
            session["user"] = user
            session.permanent = True
            return redirect(url_for("index"))
        else:
            return render_template("login.html", error="Ungültige Anmeldedaten. Bitte versuche es erneut.")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------------------------------------------------------------------
# Admin-Bereich (nur Nathan). /admin/login ist die einzige Tür rein; jede
# andere /admin*-Route gibt ohne gültige Admin-Session einen 404 zurück statt
# auf den Login umzuleiten, damit das Panel nach außen nicht sichtbar ist.
# ---------------------------------------------------------------------------
@app.route("/admin/login", methods=["GET", "POST"])
@limiter.limit("5 per 15 minutes", methods=["POST"])
def admin_login():
    if is_admin():
        return redirect(url_for("admin_panel"))

    if request.method == "POST":
        password = request.form.get("password", "")

        if check_password_hash(ADMIN_PASSWORD_HASH, password):
            session["logged_in"] = True
            session["user"] = "nathan"
            session["is_admin"] = True
            session.permanent = True
            return redirect(url_for("admin_panel"))
        else:
            return render_template("admin_login.html", error="Falsches Admin-Passwort.")
    return render_template("admin_login.html")


def get_admin_stats():
    stats = {"entries": 0, "chat_messages": 0, "push_subscriptions": 0}
    try:
        res = supabase.table("journal_entry").select("id", count="exact").execute()
        stats["entries"] = res.count or 0
    except Exception as e:
        app.logger.error(f"Admin stats: failed to count entries: {e}")
    try:
        res = supabase.table("chat_messages").select("id", count="exact").execute()
        stats["chat_messages"] = res.count or 0
    except Exception as e:
        app.logger.error(f"Admin stats: failed to count chat messages: {e}")
    try:
        res = supabase.table("push_subscriptions").select("id", count="exact").execute()
        stats["push_subscriptions"] = res.count or 0
    except Exception as e:
        app.logger.error(f"Admin stats: failed to count push subscriptions: {e}")
    return stats


@app.route("/admin")
@admin_required
def admin_panel():
    maintenance_enabled, maintenance_message = get_maintenance_state()
    return render_template(
        "admin.html",
        stats=get_admin_stats(),
        maintenance_enabled=maintenance_enabled,
        maintenance_message=maintenance_message,
    )


@app.route("/admin/maintenance/toggle", methods=["POST"])
@admin_required
def admin_maintenance_toggle():
    enabled = request.form.get("enabled") == "on"
    message = request.form.get("message", "").strip()
    try:
        set_maintenance_state(enabled, message)
    except Exception as e:
        app.logger.error(f"Failed to update maintenance state: {e}")
    return redirect(url_for("admin_panel"))


@app.route("/admin/chat/clear", methods=["POST"])
@admin_required
def admin_clear_chat():
    try:
        # Supabase verlangt für DELETE einen Filter - "id größer als 0" trifft
        # (bei einer normalen auto-increment ID-Spalte) auf alle Zeilen zu.
        supabase.table("chat_messages").delete().gt("id", 0).execute()
    except Exception as e:
        app.logger.error(f"Failed to clear chat messages: {e}")
    return redirect(url_for("admin_panel"))


@app.route("/admin/push/clear", methods=["POST"])
@admin_required
def admin_clear_push():
    try:
        supabase.table("push_subscriptions").delete().gt("id", 0).execute()
    except Exception as e:
        app.logger.error(f"Failed to clear push subscriptions: {e}")
    return redirect(url_for("admin_panel"))


def compute_highlight_score(entry: dict, seed_date: date) -> float:
    """
    Schneller heuristischer 'Mini-Highlight-Algorithmus'. Kein ML-Modell, keine
    externen Calls - läuft in Mikrosekunden pro Eintrag. Kombiniert Content-Signale
    (Textlänge, emotionale Sprache, Bild vorhanden) mit Datums-Signalen (On-this-day,
    Jahrestags-Nähe) und einem tagesbasierten Zufalls-Seed für Abwechslung.
    """
    text = (entry.get("text") or "").lower()
    title = (entry.get("title") or "").lower()
    combined = f"{title} {text}"
    score = 0.0

    # --- Content-Signale ---
    keyword_hits = sum(1 for kw in EMOTIONAL_KEYWORDS if kw in combined)
    score += keyword_hits * 8

    score += min(text.count("!"), 5) * 2
    emoji_count = len(EMOJI_PATTERN.findall(combined))
    score += min(emoji_count, 5) * 3

    length = len(text)
    if 150 <= length <= 1200:
        score += 10
    elif length > 1200:
        score += 5

    if entry.get("image_url"):
        score += 12

    # --- Datums-Signale ---
    entry_date_str = entry.get("date")
    if entry_date_str:
        try:
            y, m, d = map(int, entry_date_str.split("-"))
            entry_date = date(y, m, d)

            # "Am selben Tag vor X Jahren" - klassischer On-this-day-Bonus
            if entry_date.month == seed_date.month and entry_date.day == seed_date.day:
                score += 40

            # Nähe zum gemeinsamen Jahrestag (27. April)
            if entry_date.month == 4 and entry_date.day == 27:
                score += 20
        except (ValueError, TypeError):
            pass

    # --- Seed-basierte Variation ---
    # Deterministischer Pseudo-Zufall pro Tag + Eintrag: sorgt für Abwechslung
    # ohne dass echte Zufälligkeit bei jedem Reload die Reihenfolge durcheinanderwirbelt.
    seed_str = f"{entry.get('id')}-{seed_date.isoformat()}"
    seed_hash = int(hashlib.sha256(seed_str.encode()).hexdigest(), 16)
    jitter = (seed_hash % 1000) / 1000 * 15  # 0-15 Punkte Rauschen
    score += jitter

    return score


@app.route("/api/entries")
def get_entries():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    limit = request.args.get("limit", type=int)
    sort = request.args.get("sort", "newest")  # newest, oldest, highlights
    search = request.args.get("search", "")

    SORT_COLUMN = "date"

    try:
        query = supabase.table("journal_entry").select("*")

        if search:
            safe_search = (
                search.replace("\\", "\\\\")
                      .replace(",", "\\,")
                      .replace("(", "\\(")
                      .replace(")", "\\)")
                      .replace("%", "\\%")
                      .replace("_", "\\_")
            )
            query = query.or_(f"title.ilike.%{safe_search}%,text.ilike.%{safe_search}%")

        if sort == "highlights":
            query = query.order(SORT_COLUMN, desc=True)
        elif sort == "oldest":
            query = query.order(SORT_COLUMN, desc=False)
            if limit:
                query = query.limit(limit)
        else:  # newest (default)
            query = query.order(SORT_COLUMN, desc=True)
            if limit:
                query = query.limit(limit)

        response = query.execute()
        entries_list = response.data

        if sort == "highlights":
            seed_date = date.today()
            for entry in entries_list:
                entry["_highlight_score"] = compute_highlight_score(entry, seed_date)
            entries_list.sort(key=lambda e: e["_highlight_score"], reverse=True)
            for entry in entries_list:
                del entry["_highlight_score"]
            if limit:
                entries_list = entries_list[:limit]

        for entry in entries_list:
            if entry.get("date"):
                entry["time_ago"] = time_ago(entry["date"])
            else:
                entry["time_ago"] = ""

    except Exception as e:
        app.logger.error(f"Database fetch failed: {e}")
        return jsonify({"error": "Fehler beim Laden der Erinnerungen"}), 500

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


@app.route("/chat")
def chat():
    if not is_logged_in():
        return redirect(url_for("login"))

    return render_template(
        "chat.html",
        chat_partner=get_other_user(session.get("user")),
    )


def get_other_user(username):
    if username == "nathan":
        return "luisa"
    if username == "luisa":
        return "nathan"
    return None


def normalize_chat_message_row(row):
    row = dict(row)
    row["is_self"] = row.get("sender") == session.get("user")
    row["is_read"] = bool(row.get("read_at"))
    if row["is_self"]:
        row["delivery_status"] = "Gelesen" if row["is_read"] else "Gesendet"
    else:
        row["delivery_status"] = ""
    return row


def insert_chat_message(sender, recipient, message, kind="message", entry_id=None, entry_title=None):
    payload = {
        "sender": sender,
        "recipient": recipient,
        "message": message,
        "kind": kind,
    }
    if entry_id is not None:
        payload["entry_id"] = entry_id
    if entry_title:
        payload["entry_title"] = entry_title

    supabase.table("chat_messages").insert(payload).execute()


def mark_chat_messages_read(sender, recipient):
    try:
        response = (
            supabase.table("chat_messages")
            .select("id, read_at")
            .eq("sender", sender)
            .eq("recipient", recipient)
            .execute()
        )
        unread_ids = [row["id"] for row in (response.data or []) if not row.get("read_at")]
        if not unread_ids:
            return

        supabase.table("chat_messages").update({
            "read_at": datetime.utcnow().isoformat() + "Z",
        }).in_("id", unread_ids).execute()
    except Exception as e:
        app.logger.error(f"Failed to mark chat messages read: {e}")


@app.route("/api/chat/messages")
def get_chat_messages():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user = session.get("user")
    partner = get_other_user(current_user)
    if not partner:
        return jsonify({"messages": []})

    try:
        # Filtert direkt in der DB: (sender=A UND recipient=B) ODER (sender=B UND recipient=A)
        filter_str = f"and(sender.eq.{current_user},recipient.eq.{partner}),and(sender.eq.{partner},recipient.eq.{current_user})"
        
        response = (
            supabase.table("chat_messages")
            .select("*")
            .or_(filter_str)
            .order("created_at", desc=False)
            .limit(200)
            .execute()
        )
        
        rows = [normalize_chat_message_row(row) for row in (response.data or [])]

        if rows:
            mark_chat_messages_read(partner, current_user)
    except Exception as e:
        app.logger.error(f"Failed to fetch chat messages: {e}")
        rows = []

    return jsonify({"messages": rows})

@app.route("/api/chat/unread_count")
def get_unread_chat_count():
    if not is_logged_in():
        return jsonify({"unread_count": 0}), 401

    current_user = session.get("user")
    partner = get_other_user(current_user)
    if not partner:
        return jsonify({"unread_count": 0})

    try:
        response = (
            supabase.table("chat_messages")
            .select("id, read_at")
            .eq("sender", partner)
            .eq("recipient", current_user)
            .execute()
        )
        unread_count = sum(1 for row in (response.data or []) if not row.get("read_at"))
        return jsonify({"unread_count": unread_count})
    except Exception as e:
        app.logger.error(f"Failed to fetch unread chat count: {e}")
        return jsonify({"unread_count": 0})


@app.route("/api/chat/send", methods=["POST"])
def send_chat_message():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user = session.get("user")
    partner = get_other_user(current_user)
    if not partner:
        return jsonify({"error": "Unknown user"}), 400

    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()

    if not message:
        return jsonify({"error": "Message is required"}), 400

    try:
        insert_chat_message(current_user, partner, message, kind="message")
        threading.Thread(
            target=send_push_notifications_to_user,
            args=(
                partner,
                f"Neue Nachricht von {current_user.capitalize()}",
                message,
                "/chat",
            ),
            daemon=True,
        ).start()
        return jsonify({"success": True})
    except Exception as e:
        app.logger.error(f"Failed to send chat message: {e}")
        return jsonify({"error": "Database error"}), 500


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
            if image_url is None:
                # Datei hatte eine erlaubte Endung, war aber kein echtes Bild
                # (z.B. manipuliert/beschädigt) -> Eintrag NICHT anlegen.
                return handle_error(400)

    # Save to database using Supabase API insert
    try:
        supabase.table("journal_entry").insert({
            "title": title,
            "text": text,
            "date": date,
            "image_url": image_url,
            "storage_path": storage_path,
            "img_placeholder_str": img_placeholder_str,
            "created_by": current_user
        }).execute()
        current_user = session.get("user")
        partner = get_other_user(current_user)
        if partner:
            threading.Thread(
                target=send_push_notifications_to_user,
                args=(
                    partner,
                    "Ein neuer Moment! 💕",
                    f"{current_user.capitalize()} hat eine neue Erinnerung hinzugefügt: \"{title}\"",
                    "/gallery",
                ),
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
            image_url, storage_path, img_placeholder_str = process_and_upload_image(file)
            if image_url is None:
                # Ungültiges Bild -> altes Bild NICHT löschen, Update abbrechen.
                return handle_error(400)

            # Erst jetzt, nachdem das neue Bild erfolgreich validiert & hochgeladen
            # wurde, das alte Bild aus dem Storage entfernen.
            delete_image_from_storage(entry.get("storage_path"))

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


@app.route("/api/push/test", methods=["POST"])
def test_push_notification():
    if not is_logged_in():
        return jsonify({"error": "Unauthorized"}), 401

    current_user = session.get("user")
    if not current_user:
        return jsonify({"error": "Unknown user"}), 400

    threading.Thread(
        target=send_push_notifications_to_user,
        args=(
            current_user,
            "Test-Benachrichtigung 🔔",
            f"Hallo {current_user.capitalize()}! Deine Benachrichtigungen funktionieren perfekt. 💕",
            "/",
            True,  # isTest flag
        ),
        daemon=True,
    ).start()

    return jsonify({"success": True})


def send_push_notifications(title, message, url_path="/gallery", isTest=False):
    if message and len(message) > 120:
        message = message[:117] + "..."
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

    payload = json.dumps({
        "title": title,
        "body": message,
        "url": url_path,
        "isTest": isTest
    })

    seen_endpoints = set()
    for sub in subscriptions:
        sub_data = sub.get("subscription_data")
        endpoint = (sub_data or {}).get("endpoint")
        if not endpoint or endpoint in seen_endpoints:
            continue
        seen_endpoints.add(endpoint)
        parsed_url = urlparse(endpoint)
        audience = f"{parsed_url.scheme}://{parsed_url.netloc}"
        vapid_claims = {
            "sub": vapid_contact,
            "aud": audience,
            "exp": int(time.time()) + 12 * 3600
        }
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


def send_push_notifications_to_user(username, title, message, url_path="/gallery", isTest=False):
    if message and len(message) > 120:
        message = message[:117] + "..."
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
        "url": url_path,
        "isTest": isTest
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

    try:
        insert_chat_message(
            current_user,
            target_user,
            body,
            kind="reminder",
            entry_id=entry_id,
            entry_title=entry.get("title"),
        )
    except Exception as e:
        app.logger.error(f"Failed to store reminder in chat: {e}")

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
