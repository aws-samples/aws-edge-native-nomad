agent {
  policy = "read"
}

node {
  policy = "read"
}

namespace "*" {
  policy = "write"
  capabilities = ["submit-job", "read-logs"]
}