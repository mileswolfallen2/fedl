export default {
  async email(message, env, ctx) {
    const subject = message.headers.get('subject') || 'No Subject';
    const from = message.from;
    const to = message.to;

    console.log(`[FEDL Email] Received email from: ${from}, to: ${to}, subject: ${subject}`);

    const forwardedAddress = env.FORWARD_TO || '';

    if (forwardedAddress) {
      await message.forward(forwardedAddress);
      console.log(`[FEDL Email] Forwarded to: ${forwardedAddress}`);
    } else {
      console.log(`[FEDL Email] No forwarding address configured (FORWARD_TO not set)`);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/send' && request.method === 'POST') {
      const body = await request.json() as { to: string; subject: string; text: string };
      
      if (!body.to || !body.subject || !body.text) {
        return new Response(JSON.stringify({ error: 'Missing to, subject, or text' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        await env.SEND_EMAIL.send({
          from: `FEDL <help@fedl.site>`,
          to: body.to,
          subject: body.subject,
          text: body.text,
        });

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error: any) {
        console.error(`[FEDL Email] Send failed: ${error.message}`);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('FEDL Email Worker\n', { status: 200 });
  }
} satisfies ExportedHandler<Env>;

interface Env {
  SEND_EMAIL: any;
  FORWARD_TO: string;
}
