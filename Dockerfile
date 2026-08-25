# Stage 1: Build the React SPA and compile the Express backend
FROM node:20-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility
RUN apk add --no-cache openssl

# Copy dependency configuration and Prisma schema
COPY package.json package-lock.json* bun.lock* ./
COPY prisma ./prisma/

# Install all dependencies (production + development)
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application source files
COPY . .

# Run the production build (Vite client build & esbuild server compilation)
RUN npm run build

# Stage 2: Runtime Production Image
FROM node:20-alpine AS runner

WORKDIR /app

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl

# Set node environment to production
ENV NODE_ENV=production

# Copy package configuration and Prisma schema
COPY package.json package-lock.json* bun.lock* ./
COPY prisma ./prisma/

# Install production dependencies and generate Prisma client for runtime
RUN npm install --omit=dev && npx prisma generate

# Copy compiled resources from builder stage
COPY --from=builder /app/dist ./dist

# Create storage directories and mount targets with full write permissions
RUN mkdir -p /app/uploads /app/storage/uploads /app/storage/temp_chunks /mnt && chmod -R 777 /app/uploads /app/storage /mnt

# Expose the default application port
EXPOSE 3000

# Startup script: automatically synchronize schema to database then start server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/server.cjs"]

