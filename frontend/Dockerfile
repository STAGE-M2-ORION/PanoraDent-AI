# Build
FROM node:20-alpine AS build
WORKDIR /app
# Le lockfile est copié avec le manifeste : `npm ci` garantit des versions
# identiques entre la CI, Docker et les postes de développement.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve via nginx (proxy /api -> backend)
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
