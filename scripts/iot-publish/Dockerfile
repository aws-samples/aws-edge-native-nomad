FROM python:3.9-slim as builder

# ARG TARGETPLATFORM
# ARG BUILDPLATFORM
# RUN echo "I am running on $BUILDPLATFORM, building for $TARGETPLATFORM"

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY *.py /app
COPY requirements.txt /app

# Install any needed packages specified in requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# Install the AWS CLI for debugging (it's pretty big so only include it if needed)
# RUN apt update && apt install -y less vim curl unzip
# RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
# RUN unzip awscliv2.zip
# RUN ./aws/install

# Stage 2: Build ARM64 image
FROM --platform="linux/arm64" python:3.9-slim

# Copy Python dependencies from the previous stage
COPY --from=builder /usr/local/lib/python3.9/site-packages/ /usr/local/lib/python3.9/site-packages/

# Copy your application code to the working directory
COPY . /app

# Set the working directory
WORKDIR /app

CMD  [ "python3", "publish.py" ]
