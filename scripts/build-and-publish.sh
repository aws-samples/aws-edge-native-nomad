#!/bin/bash

# helper to check that the script is run with two args
if [ $# -ne 2 ]; then
    echo "Usage: $0 <aws-region> <aws-account-id>"
    exit 1
fi

# pass arguments to variables
AWS_REGION=$1
AWS_ACCOUNT_ID=$2

ECR_REPOSITORY=iot-publish
ECR_TAG=latest
ECR_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY
ECR_LATEST=$ECR_URI:$ECR_TAG

echo IoT Endpoint: $IOT_ENDPOINT
echo AWS Region: $AWS_REGION
echo AWS Account ID: $AWS_ACCOUNT_ID
echo ECR Repository: $ECR_LATEST

# Check if the repository already exists
aws ecr describe-repositories --repository-names $ECR_REPOSITORY > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "ECR repository '$ECR_REPOSITORY' already exists."
else
  # Create the repository
  aws ecr create-repository --repository-name $ECR_REPOSITORY > /dev/null 2>&1
  echo "ECR repository '$ECR_REPOSITORY' created successfully."
fi

set -e

# Build for ARM64 since we are deploying to a RaspberryPi 4 with 64 bit OS
docker build -t iot-publish ./scripts/iot-publish
docker images iot-publish:latest

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI
docker tag iot-publish:latest $ECR_LATEST

docker push $ECR_LATEST

mkdir -p scripts/generated

cat << EOF > "./scripts/generated/iot-publish.nomad.hcl"
job "iot-publish" {
  datacenters = ["*"]
  type = "service"

  group "iot-publish" {
    count = 1

    task "iot-publish" {
      driver = "docker"

      config {
        image = "$ECR_LATEST"
          volumes = [
            "/root/aws:/root/.aws",
            "/root/certificates:/root/certificates",
            "/usr/bin:/usr/bin"
        ]
      }
    }
  }
}
EOF

cat scripts/generated/iot-publish.nomad.hcl
echo
echo Success! Now run the following command:
echo
echo -e '\t nomad job plan scripts/generated/iot-publish.nomad.hcl'
echo