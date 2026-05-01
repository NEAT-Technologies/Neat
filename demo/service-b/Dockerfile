FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001
CMD ["npm", "start"]
