# Local Development Setup

This document provides instructions for setting up and running the application in a local development environment. This setup uses a standard Node.js server and does not require any Cloudflare-specific services.

## Prerequisites

- Node.js (v18 or later)
- npm or bun

## Installation

1.  **Install dependencies:**

    ```bash
    npm install
    ```

    or

    ```bash
    bun install
    ```

2.  **Set up the database:**

    This project uses a local SQLite database. To set up the database and apply migrations, run the following command:

    ```bash
    npx drizzle-kit push
    ```

## Authentication Setup (Clerk)

This project uses [Clerk](https://clerk.com/) for authentication. To get started, you will need to create a free Clerk account and set up a new application.

1.  **Create a Clerk Application:**
    - Go to the [Clerk Dashboard](https://dashboard.clerk.com/) and create a new application.
    - Give your application a name and choose your preferred sign-in options.

2.  **Get API Keys:**
    - In your Clerk application dashboard, navigate to **API Keys**.
    - You will need the **Publishable key** and the **Secret key**.

3.  **Configure Environment Variables:**
    - Create a new file named `.env` in the root of the project by copying the `.env.example` file.
    - Open the `.env` file and add the keys you obtained from the Clerk dashboard:

    ```env
    CLERK_SECRET_KEY="YOUR_CLERK_SECRET_KEY"
    CLERK_PUBLISHABLE_KEY="YOUR_CLERK_PUBLISHABLE_KEY"
    ```

## Running the Application

1.  **Start the backend server:**

    To start the backend server, run the following command. This will start the Hono application on a Node.js server, which will be available at `http://localhost:3000` by default.

    ```bash
    npm run dev:node
    ```

2.  **Start the frontend development server:**

    In a separate terminal, start the Vite frontend development server:

    ```bash
    npm run dev
    ```

    The frontend will be available at `http://localhost:5173`.

## Environment Variables

The application is configured using a `.env` file. See the `.env.example` file for a full list of available options.

```
# Clerk Authentication
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=

# Application
PORT=3000
CUSTOM_DOMAIN=localhost:5173
NODE_ENV=development
```