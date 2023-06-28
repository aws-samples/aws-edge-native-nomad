import boto3

acm_pca_client = boto3.client('acm-pca')

def handler(event, context):

    # Get certificate parameters from Lambda event
    acm_pca_arn = event['acmPcaArn']

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
