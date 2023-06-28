import boto3
import time
import json
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)

# Create IoT client
client = boto3.client('iot-data')

# Specify the topic and message
topic = 'hello/world'
counter = 0

while True:
    try:
        message = {
            "counter": counter,
        }
        # Publish the message
        response = client.publish(
            topic=topic,
            qos=0,
            payload=json.dumps(message)
        )
        logging.info(f"Message {counter} published successfully.")

        # Wait for a second
        counter += 1
        time.sleep(1)

    except (client.exceptions.InternalFailureException, 
            client.exceptions.InvalidRequestException, 
            client.exceptions.UnauthorizedException, 
            client.exceptions.MethodNotAllowedException, 
            client.exceptions.ThrottlingException) as e:
        logging.error(f"Exception occurred while publishing: {e}")
        break
