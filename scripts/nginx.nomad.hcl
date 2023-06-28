job "nginx" {
  datacenters = ["*"]
  group "nginx" {
    network {
      mode = "bridge"
      port "http" {
        static = 8080
        to = 80
      }
    }
    count = 1
    task "server" {
      driver = "docker"
      config {
        image = "public.ecr.aws/nginx/nginx:1.22-arm64v8"
        ports = ["http"]
      }
    }
  }
}
