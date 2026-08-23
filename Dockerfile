# Stage 1: Build the React SPA and compile the Express backend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency configuration files
COPY package.json ./

# Install all dependencies (production + development)
RUN npm install

# Copy the rest of the application files
COPY . .

# Run the production build (vite build & esbuild compilation)
RUN npm run build

# Stage 2: Runtime Production Image
FROM node:20-alpine AS runner

WORKDIR /app

# Set node environment to production
ENV NODE_ENV=production

# Copy package configuration
COPY package.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy compiled resources from builder stage
COPY --from=builder /app/dist ./dist

# Create storage directory and mount target with secure permissions
RUN mkdir -p /app/uploads /mnt && chmod 777 /app/uploads /mnt

# Expose the default application port
EXPOSE 3000

# Start the Node.js production server
CMD ["node", "dist/server.cjs"]
