#!/bin/bash

# this script set nomad with information only available at runtime. This script expects few environment variables to be defined:
# 1.  DC_NAME : the name of the nomad data center for the nomad server cluster
# 2.  REGION : the name of the region where the datacenter is located (this is not correlated with AWS region)
# 3.  DC_NOMAD_INSTANCE_COUNT : the numbers of nomad server in the cluster (should be in [1,3,5,7,9])
# 4.  AWS_REGION : the AWS region where the nomad cluster is being deployed
# 5.  NOMAD_SERVER_TAG_KEY: the tag key associated with ec2 instances running a nomad server (containerized or not)
# 6.  NOMAD_SERVER_TAG_VALUE: the tag value associated with ec2 instances running a nomad server (containerized or not)
# 7.  NOMAD_CA_CERTIFICATE: the certificate of the CA
# 6.  NOMAD_SERVER_CERTIFICATE: the certificate of the server
# 6.  NOMAD_SERVER_PRIVATE_KEY: the private key associated with the server certificate



# inject ca certificate 
echo "$NOMAD_CA_CERTIFICATE" > /etc/certificates/nomad/ca.pem

# inject ca certificate 
echo "$NOMAD_SERVER_CERTIFICATE" > /etc/certificates/nomad/server.pem

# inject ca certificate 
echo "$NOMAD_SERVER_PRIVATE_KEY" > /etc/certificates/nomad/server-key.pem


TASK_ARN=$(curl $ECS_CONTAINER_METADATA_URI_V4/task | jq '.TaskARN' --raw-output)


NOMAD_ALLOC_DIR="/opt/nomad/alloc"
mkdir -p $NOMAD_ALLOC_DIR

echo "NOMAD_TASK_DIR = /opt/nomad/$TASK_ARN/local"
NOMAD_TASK_DIR="/opt/nomad/$TASK_ARN/local"
mkdir -p $NOMAD_TASK_DIR
 
echo "NOMAD_SECRETS_DIR = /opt/nomad/$TASK_ARN/secrets"
NOMAD_SECRETS_DIR="/opt/nomad/$TASK_ARN/secrets"
mkdir -p $NOMAD_SECRETS_DIR

echo "NOMAD_CONFIG_DIR = /opt/nomad/$TASK_ARN/config"
NOMAD_CONFIG_DIR="/opt/nomad/$TASK_ARN/config"
mkdir -p $NOMAD_CONFIG_DIR


# inject data center name with nomad configuration
cat << EOF > $NOMAD_CONFIG_DIR/nomad.hcl
bind_addr  = "0.0.0.0"
data_dir   = "${NOMAD_TASK_DIR}"
datacenter = "${DC_NAME}"
log_level  = "DEBUG"
advertise {
  http = "${NOMAD_HTTP_ENDPOINT}:4646"
  rpc  = "${NOMAD_RPC_ENDPOINT}:4647"
  serf = "{{ GetDefaultInterfaces | include \"type\" \"ipv4\" | attr \"address\" }}"
}

EOF

# inject server configuration with nomad server configuration
cat <<EOF > $NOMAD_CONFIG_DIR/server.hcl
acl {
  enabled = true
}


region = "${REGION}"


server {
  enabled          = true
  bootstrap_expect = $DC_NOMAD_INSTANCE_COUNT
  server_join {
    retry_join = ["provider=aws region=${AWS_REGION} tag_key=${NOMAD_SERVER_TAG_KEY} tag_value=${NOMAD_SERVER_TAG_VALUE}"]
  }
  raft_protocol    = 3
}


# Require TLS
tls {
  http = true
  rpc  = true

  ca_file   = "/etc/certificates/nomad/ca.pem"
  cert_file = "/etc/certificates/nomad/server.pem"
  key_file  = "/etc/certificates/nomad/server-key.pem"

  verify_server_hostname = true
  verify_https_client    = false
}

autopilot {
  cleanup_dead_servers      = true
  last_contact_threshold    = "5s"
}


EOF

/usr/bin/nomad agent -config $NOMAD_CONFIG_DIR

