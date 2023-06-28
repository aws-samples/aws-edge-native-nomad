job "iot-publish" {
  datacenters = ["*"]
  type = "service"

  group "iot-publish" {
    count = 1

    task "iot-publish" {
      driver = "docker"

      config {
        image = "my-image"
          volumes = [
            "/root/aws:/root/.aws",
            "/root/certificates:/root/certificates",
            "/usr/bin:/usr/bin"
        ]
      }
    }
  }
}
