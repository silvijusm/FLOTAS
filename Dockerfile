FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV DB_FILE=/data/flotas.db
VOLUME /data
EXPOSE 3000
CMD ["node","server.js"]
