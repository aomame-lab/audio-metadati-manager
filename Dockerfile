# Use a small official Debian-based PHP image with PHP CLI
FROM php:8.2-cli-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy project files (excluding those in .dockerignore)
COPY . /app

# Create a Python virtual environment in /app/.venv
RUN python3 -m venv /app/.venv

# Install Python dependencies from requirements.txt
RUN /app/.venv/bin/pip install --no-cache-dir -r requirements.txt

# Ensure permissions are correct for the application user
# We'll run as root for simplicity in this home-server context, 
# but we allow UID/GID overrides via docker-compose if needed.
# The app needs to write to the mounted music volume.

# Expose the PHP built-in server port
EXPOSE 8000

# Use the PHP built-in server as the entrypoint
# -S 0.0.0.0:8000 listens on all interfaces
# -t /app/web sets the document root
CMD ["php", "-S", "0.0.0.0:8000", "-t", "/app/web"]
