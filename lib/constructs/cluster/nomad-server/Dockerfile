FROM ubuntu:kinetic

ARG NOMAD_VERSION="1.5.3"

RUN apt-get update; apt-get install -y unzip tar jq wget iproute2 curl

RUN useradd -m -d /srv/nomad nomad




# download binaries
RUN wget https://releases.hashicorp.com/nomad/$NOMAD_VERSION/nomad_${NOMAD_VERSION}_linux_amd64.zip
RUN unzip nomad_${NOMAD_VERSION}_linux_amd64.zip -d /usr/bin

# create directory for nomad
COPY ./start_nomad.sh /usr/bin
RUN chmod a+x  /usr/bin/start_nomad.sh
RUN mkdir -p /opt/nomad/
RUN chown -R nomad:nomad /opt/nomad/
RUN mkdir -p /ops/
RUN chown -R nomad:nomad /ops/
RUN mkdir -p /etc/certificates/nomad
RUN chown -R nomad:nomad /etc/certificates/nomad/



# Create a nomad user inseat of using root
USER nomad

RUN mkdir -p /opt/nomad/data

RUN mkdir -p /opt/nomad/config
# stores ACL
RUN mkdir -p /ops/config

# define port to expose

# HTTP API.
EXPOSE 4646

# RPC API.
EXPOSE 4647

# SERF API.
EXPOSE 4648 4648/udp


ENTRYPOINT ["/usr/bin/start_nomad.sh"]

