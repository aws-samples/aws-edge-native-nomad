from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import ipaddress
import boto3

acm_pca_client = boto3.client('acm-pca')


def handler(event, context):
    # Get certificate parameters from Lambda event
    acm_pca_arn = event['acmPcaArn']
    cn = event['commonName']
    san = event['subjectAlternativeName']
    expiry_days = int(event['expiryDays'])
    secret_prefix = event['secretPrefix']

    # Generate a new key
    new_cert_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )

    # Create a new CSR
    csr = x509.CertificateSigningRequestBuilder().subject_name(x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
    ])).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName(cn),
            x509.DNSName(san),
            x509.DNSName(f"localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        ]),
        critical=True,
        # Sign the CSR with our private key.
    ).sign(new_cert_key, hashes.SHA256())

    private_key_bytes = new_cert_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption()
    )

    # A CSR must provide either a subject name or a subject alternative name or the request will be rejected.
    response = acm_pca_client.issue_certificate(
        CertificateAuthorityArn=acm_pca_arn,
        Csr=csr.public_bytes(serialization.Encoding.PEM),
        SigningAlgorithm='SHA256WITHRSA',
        Validity={
            'Value': expiry_days,
            'Type': 'DAYS'
        }
    )

    cert_arn = response['CertificateArn']

    acm_cert_issued_waiter = acm_pca_client.get_waiter('certificate_issued')
    acm_cert_issued_waiter.wait(
        CertificateAuthorityArn=acm_pca_arn,
        CertificateArn=cert_arn,
        WaiterConfig={
            'Delay': 3,
            'MaxAttempts': 60
        }
    )

    response = acm_pca_client.get_certificate(
        CertificateAuthorityArn=acm_pca_arn,
        CertificateArn=cert_arn
    )

    cert = response['Certificate']
    cert_chain = response['CertificateChain']

    return {
        "caCertSecretId": "ca-caCertificate",
        "caCertificate": cert_chain,
        "privateKeySecretId": f"{secret_prefix}-PrivateKey",
        "certificateSecretId": f"{secret_prefix}-Certificate",
        "privateKey": private_key_bytes.decode("utf-8"),
        "certificate": cert
    }
