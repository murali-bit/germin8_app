FROM node:20-alpine AS base
WORKDIR /app

# Install root dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY server.js .env.example ./
COPY website/ ./website/
COPY products/ ./products/

# Build marketing website
WORKDIR /app/website
RUN npm install && npm run build && rm -rf node_modules

# Build Tally2Zoho frontend
WORKDIR /app/products/tally2zoho/frontend
RUN npm install && npm run build && rm -rf node_modules

# Build MCA dashboard
WORKDIR /app/products/mca-suite/dashboard
RUN npm install && npm run build && rm -rf node_modules

# Install product backend dependencies
WORKDIR /app/products/tally2zoho/server
RUN npm install --omit=dev

WORKDIR /app/products/mca-suite/backend
RUN npm install --omit=dev

# Production stage
FROM node:20-alpine
WORKDIR /app

COPY --from=base /app ./

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
