"""Stockage objet S3-compatible (MinIO en local, S3 en prod).
Images anonymisées et rapports PDF. Chiffrement au repos géré par le backend S3."""
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from ..config import settings

_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    config=Config(signature_version="s3v4"),
    region_name="us-east-1",
)


def ensure_bucket():
    try:
        _s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        _s3.create_bucket(Bucket=settings.s3_bucket)


def put(key: str, data: bytes, content_type: str):
    _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)
    return key


def get(key: str) -> bytes:
    obj = _s3.get_object(Bucket=settings.s3_bucket, Key=key)
    return obj["Body"].read()


def presigned_url(key: str, expires: int = 3600) -> str:
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=expires,
    )
    # La signature couvre le chemin et l'en-tête Host, pas l'origine : le proxy
    # public (nginx `/storage/`) rétablit `Host: minio:9000` avant MinIO.
    if settings.s3_public_url and url.startswith(settings.s3_endpoint):
        url = settings.s3_public_url.rstrip("/") + url[len(settings.s3_endpoint.rstrip("/")):]
    return url
