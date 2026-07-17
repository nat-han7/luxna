import os
from dotenv import load_dotenv
from pywebpush import webpush, WebPushException
import json

load_dotenv()

vapid_private = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
vapid_public = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
vapid_mailto = os.environ.get("VAPID_MAILTO", "").strip().strip('"').strip("'")

print(f"Private Key: {vapid_private[:15]}...")
print(f"Public Key: {vapid_public[:15]}...")
print(f"Mailto: {vapid_mailto}")

# Test subscription data structure (dummy)
sub_data = {
    "endpoint": "https://updates.push.services.mozilla.com/wpush/v2/gAAAA...",
    "keys": {
        "auth": "us-C26UW1BF145-D92gAxQ",
        "p256dh": "BLm3v_p-m6Vq..."
    }
}

vapid_claims = {"sub": f"mailto:{vapid_mailto}" if not vapid_mailto.startswith("mailto:") else vapid_mailto}

payload = json.dumps({
    "title": "Test Title",
    "body": "Test Body",
    "url": "/"
})

try:
    # Try calling webpush (it should try to send, and fail with HTTP error, but it shouldn't fail with key encoding error)
    webpush(
        subscription_info=sub_data,
        data=payload,
        vapid_private_key=vapid_private,
        vapid_claims=vapid_claims
    )
    print("Success: webpush call finished (or raised WebPushException due to bad endpoint, which means key is valid!)")
except WebPushException as ex:
    print(f"WebPushException raised: {ex}")
    print(f"Response: {ex.response}")
except Exception as e:
    print(f"Other Exception raised (key format error?): {e}")
