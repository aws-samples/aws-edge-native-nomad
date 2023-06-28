#!/bin/bash

aws secretsmanager get-secret-value --secret-id ca-caCertificate  --query 'SecretString' --output text > ca.pem
NOMAD_DNS=$(aws ssm get-parameter --name /infrastructure/nomad/endpoint --query 'Parameter.Value' --output text)

export NOMAD_ADDR=https://$NOMAD_DNS:4646
export NOMAD_CACERT=$PWD/ca.pem
export NOMAD_TOKEN=$(nomad login -json | jq '.SecretID' -r)
