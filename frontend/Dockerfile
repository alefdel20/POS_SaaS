# Etapa 1: Construcción
FROM node:20-alpine AS build
WORKDIR /app

# Copiamos desde la raíz del repo hacia el contenedor
COPY frontend/package*.json ./
RUN npm install

# Copiamos todo el contenido de la carpeta frontend
COPY frontend/ ./
ARG VITE_OPENPAY_MERCHANT_ID
ARG VITE_OPENPAY_PUBLIC_KEY
ARG VITE_OPENPAY_SANDBOX
ENV VITE_OPENPAY_MERCHANT_ID=$VITE_OPENPAY_MERCHANT_ID
ENV VITE_OPENPAY_PUBLIC_KEY=$VITE_OPENPAY_PUBLIC_KEY
ENV VITE_OPENPAY_SANDBOX=$VITE_OPENPAY_SANDBOX
RUN npm run build

# Etapa 2: Servidor Nginx
FROM nginx:stable-alpine
# IMPORTANTE: Aquí también incluimos 'frontend/' para que encuentre el config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Vite por defecto saca todo a /app/dist dentro del contenedor
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]