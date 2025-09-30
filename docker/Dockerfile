FROM ubuntu:22.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Copy and run setup script
COPY setup.sh /tmp/setup.sh
RUN chmod +x /tmp/setup.sh && /tmp/setup.sh

# Reset frontend to default
ENV DEBIAN_FRONTEND=

# Set working directory
WORKDIR /home/ubuntu

# Keep container running
CMD ["tail", "-f", "/dev/null"]
