#!/usr/bin/env python
import sys
import uuid

import boto3
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import ipaddress

class CertGenerator():
    def __init__(self):
        pass

    def run(self, robot_id, aws_profile, acm_pca_arn, region):

        boto3.setup_default_session(profile_name=aws_profile,region_name=region)
        acm_pca_client = boto3.client('acm-pca')
        
        # Generate a new key
        new_cert_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend()
        )

        csr = x509.CertificateSigningRequestBuilder().subject_name(x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, robot_id),
            x509.NameAttribute(NameOID.SERIAL_NUMBER, str(uuid.uuid4()))
        ])).add_extension(
                x509.SubjectAlternativeName([
                    x509.DNSName(f"client.{region}.nomad"),
                    x509.DNSName(f"localhost"),
                    x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
                ]),
            critical=True,
        # And sign the CSR with our private key.
        ).sign(new_cert_key, hashes.SHA256())
        
        # Ask Amazon Certificate Manager Private Certificate Authority to issue a certificate
        # from the CSR we just created.
        response = acm_pca_client.issue_certificate(
            CertificateAuthorityArn=acm_pca_arn,
            Csr=csr.public_bytes(serialization.Encoding.PEM),
            SigningAlgorithm='SHA256WITHRSA',
            Validity={
                'Value': 5,
                'Type': 'YEARS'
            }
        )

        cert_arn = response['CertificateArn']

        # Wait for the certificate to be issued before retrieving it.
        acm_cert_issued_waiter = acm_pca_client.get_waiter('certificate_issued')
        acm_cert_issued_waiter.wait(
            CertificateAuthorityArn=acm_pca_arn,
            CertificateArn=cert_arn,
            WaiterConfig={
                'Delay': 3,
                'MaxAttempts': 60
            }
        )

        # Retrieve the certificate
        response = acm_pca_client.get_certificate(
            CertificateAuthorityArn=acm_pca_arn,
            CertificateArn=cert_arn
        )

        cert = response['Certificate']
        cert_chain = response['CertificateChain']

        # Write our key to disk for safe keeping
        with open(f"./generated/{robot_id}-key.pem", "wb") as f:
            f.write(new_cert_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
                # encryption_algorithm=serialization.BestAvailableEncryption(b"my_passphrase"),
            ))

        # Write our certificate out to disk in a chain with the CA cert
        with open(f"./generated/{robot_id}.pem", "wb") as f:
            f.write(cert.encode())
            f.write(b'\n')
            f.write(cert_chain.encode())
            
        sys.exit(0)


def main():
    generator = CertGenerator()
    generator.run(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])


if __name__ == '__main__':
    main()
