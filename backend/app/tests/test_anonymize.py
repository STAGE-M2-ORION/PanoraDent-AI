import io
from PIL import Image
from app.services.anonymize import anonymize


def test_anonymize_image_strips_and_greyscales():
    img = Image.new("RGB", (64, 32), (120, 30, 30))
    buf = io.BytesIO(); img.save(buf, format="JPEG")
    out_img, out_bytes = anonymize(buf.getvalue(), "photo.jpg")
    assert out_img.mode == "L"
    assert out_img.size == (64, 32)
    assert out_bytes[:8] == b"\x89PNG\r\n\x1a\n"  # ré-encodé en PNG sans EXIF
