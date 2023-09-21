import os
import tempfile
import requests
import boto3
from botocore.exceptions import ClientError

# Create a Secrets Manager client
session = boto3.session.Session()
client_secretsmanager = session.client(
    service_name='secretsmanager',
    region_name=os.environ['AWS_REGION']
)

client_ssm = session.client(
    service_name='ssm',
    region_name=os.environ['AWS_REGION']
)


def put_secret(secret_name, secret_value):
    # This functions aims at writing a secret in AWS Secrets Manager
    try:
        client_secretsmanager.put_secret_value(
            SecretId=secret_name,
            SecretString=secret_value
        )
    except ClientError as e:
        # For a list of exceptions thrown, see
        # https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
        raise e


def download_certificate(secret_name):
    # In this sample we only handle the specific exceptions for the 'GetSecretValue' API.
    # See https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    # We rethrow the exception by default.
    certificate_path = ""

    try:
        get_secret_value_response = client_secretsmanager.get_secret_value(
            SecretId=secret_name
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'DecryptionFailureException':
            # Secrets Manager can't decrypt the protected secret text using the provided KMS key.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InternalServiceErrorException':
            # An error occurred on the server side.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidParameterException':
            # You provided an invalid value for a parameter.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidRequestException':
            # You provided a parameter value that is not valid for the current state of the resource.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'ResourceNotFoundException':
            # We can't find the resource that you asked for.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
    else:
        # Decrypts secret using the associated KMS key.
        # Depending on whether the secret is a string or binary, one of these fields will be populated.
        if 'SecretString' in get_secret_value_response:
            secret = get_secret_value_response['SecretString']
            with tempfile.NamedTemporaryFile(mode='w', delete=False) as fp:
                fp.write(secret)
                certificate_path = fp.name

        else:
            # raise exception here
            raise ValueError('Secret should be stored as SecretString')
    return certificate_path


def handler(event, context):
    ca_certificate_path = download_certificate("ca-caCertificate")
    nomad_address = os.environ['NOMAD_ADDRESS']
    oidc_client_id = os.environ['OIDC_CLIENT_ID']
    oidc_client_secret = os.environ['OIDC_CLIENT_SECRET']
    oidc_discovery_url = os.environ['OIDC_DISCOVERY_URL']

    #
    # Acquire management or bootstrap token
    #

    bootstrapped = False
    nomad_bootstrap_token = "empty"
    already_bootstrapped = False
    while not bootstrapped:
        # try to get create bootstrap token
        raw_bootstrap_response = requests.post(
            f'https://{nomad_address}:4646/v1/acl/bootstrap',
            verify=ca_certificate_path,
            timeout=5)
        if raw_bootstrap_response.status_code == 200:
            bootstrapped = True
            bootstrap_response = raw_bootstrap_response.json()
            nomad_bootstrap_token = bootstrap_response['SecretID']
        elif raw_bootstrap_response.status_code == 400:
            already_bootstrapped = True
            bootstrapped = True

    if not already_bootstrapped:
        # save bootstrap token in AWS Secrets Manager
        put_secret("/infrastructure/nomad/token/bootstrap", nomad_bootstrap_token)

        headers = {
            "X-Nomad-Token": nomad_bootstrap_token
        }

        # retrieve nom policy from SSM parameter
        policy_response = client_ssm.get_parameter(
            Name="/infrastructure/nomad/policies/submit-job",
            WithDecryption=False
        )

        policy = policy_response["Parameter"]["Value"]

        headers = {
            "X-Nomad-Token": nomad_bootstrap_token
        }

        # submit policy to nomad
        data_policy = {
            "Name": "submit-job",
            "Description": "Default policy",
            "Rules": policy
        }

        # create token associated with policy
        raw_create_policy_response = requests.post(
            f'https://{nomad_address}:4646/v1/acl/policy/submit-job',
            json=data_policy,
            headers=headers,
            verify=ca_certificate_path,
            timeout=5)

        raw_create_policy_response.raise_for_status()
        # save token in SSM parameter store
        # submit policy to nomad
        data_auth = {
            "Name": "oidc-auth",
            "Type": "OIDC",
            "TokenLocality": "local",
            "MaxTokenTTL": "1h0m0s",
            "Default": True,
            "Config": {
                "OIDCDiscoveryURL": oidc_discovery_url,
                "OIDCClientID": oidc_client_id,
                "OIDCClientSecret": oidc_client_secret,
                "OIDCScopes": [
                    "aws.cognito.signin.user.admin",
                ],
                "BoundAudiences": [oidc_client_id],
                "AllowedRedirectURIs": [
                    f"https://{nomad_address}:4646/ui/settings/tokens",
                    "http://localhost:4649/oidc/callback"
                ],
                "ClaimMappings": {
                    "username": "username"
                },

                "ListClaimMappings": {
                    "cognito:groups": "roles"
                }
            }
        }

        raw_create_auth_response = requests.post(
            f'https://{nomad_address}:4646/v1/acl/auth-method',
            json=data_auth,
            headers=headers,
            verify=ca_certificate_path,
            timeout=5
        )

        raw_create_auth_response.raise_for_status()
        create_auth_response = raw_create_auth_response.json()

        data_role = {
            "Name": "engineering-role",
            "Description": "Engineering role",
            "Policies": [
                {
                    "Name": "submit-job"
                }
            ]
        }

        raw_create_role_response = requests.post(
            f'https://{nomad_address}:4646/v1/acl/role',
            json=data_role,
            headers=headers,
            verify=ca_certificate_path,
            timeout=5
        )

        raw_create_role_response.raise_for_status()
        create_role_response = raw_create_role_response.json()

        data_binding_role = {
            "Description": "oidc-auth-acl-binding-rule",
            "AuthMethod": "oidc-auth",
            #       "Selector": "\"engineering\" in list.roles",
            "BindType": "role",
            "BindName": "engineering-role",
        }

        raw_create__binding_role_response = requests.post(
            f'https://{nomad_address}:4646/v1/acl/binding-rule',
            json=data_binding_role,
            headers=headers,
            verify=ca_certificate_path,
            timeout=5
        )

        raw_create__binding_role_response.raise_for_status()
        create__binding_role_response = raw_create__binding_role_response.json()

    return {
        "status_code": "OK"
    }
