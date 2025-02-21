import { sql } from "bun";


// Type for error handling
interface PostgresError {
  message: string;
}

// Reserve a dedicated connection for terminating other connections
const terminator = await sql.reserve();

await terminator`
  SET application_name = 'postgres-terminator';
`;

const POSTGRES_URL = process.env.POSTGRES_URL;
const SECRET_KEY = process.env.SECRET_KEY;

if (!POSTGRES_URL || !SECRET_KEY) {
  throw new Error("POSTGRES_URL and SECRET_KEY must be set");
}

const server = Bun.serve({
  port: process.env.PORT || 3493,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve the main page
    if (url.pathname === "/") {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Postgres Connection Terminator</title>
            <style>
              body {
                font-family: system-ui, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 2rem;
              }
              button {
                background: #ff4444;
                color: white;
                border: none;
                padding: 1rem 2rem;
                border-radius: 4px;
                font-size: 1.2rem;
                cursor: pointer;
              }
              button:hover {
                background: #cc0000;
              }
              .error {
                color: #cc0000;
                margin-top: 1rem;
              }
            </style>
          </head>
          <body>
            <h1>Postgres Connection Terminator</h1>
            <p>Click the button below to terminate all non-essential Postgres connections:</p>
            <button onclick="terminateConnections()">Terminate All Connections</button>
            <pre id="result"></pre>

            <script>
              async function terminateConnections() {
                const secretKey = prompt('Please enter the secret key:');
                if (!secretKey) return;

                try {
                  const res = await fetch('/terminate', { 
                    method: 'POST',
                    headers: {
                      'X-Secret-Key': secretKey
                    }
                  });
                  const data = await res.json();
                  
                  if (!res.ok) {
                    document.getElementById('result').innerHTML = '<div class="error">' + data.error + '</div>';
                    return;
                  }
                  
                  document.getElementById('result').textContent = JSON.stringify(data, null, 2);
                } catch (error) {
                  document.getElementById('result').innerHTML = '<div class="error">Failed to terminate connections</div>';
                }
              }
            </script>
          </body>
        </html>
        `,
        {
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    // Handle connection termination
    if (url.pathname === "/terminate" && req.method === "POST") {
      if (req.headers.get("X-Secret-Key") !== SECRET_KEY) {
        return Response.json(
          {
            success: false,
            error: "Invalid secret key",
          },
          { status: 401 }
        );
      }

      try {
        const result = await terminator`
          SELECT pg_terminate_backend(pid) 
          FROM pg_stat_activity 
          WHERE pid != pg_backend_pid() 
          AND usename != current_user;
        `;

        return Response.json({
          success: true,
          message: "Connections terminated successfully",
          result,
        });
      } catch (error: unknown) {
        const pgError = error as PostgresError;
        return Response.json(
          {
            success: false,
            error: pgError.message,
          },
          { status: 500 }
        );
      }
    }

    // 404 for all other routes
    return new Response("Not Found", { status: 404 });
  },
});

// Clean up the connection when the server stops
process.on("SIGTERM", () => {
  terminator.release();
});

console.log(`Server running at ${server.url}`);
