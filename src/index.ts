import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const USER_ID = "389aff07-b636-484a-8585-0da149d43d5c";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_ANON_KEY || ""
  );
}

function createServer() {
  const server = new McpServer({
    name: "Carrusely",
    version: "1.3.0",
  });

  server.registerTool(
    "list_brands",
    { description: "Lista las marcas del usuario" },
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, handle, tone")
        .eq("user_id", USER_ID);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "list_templates",
    { description: "Lista los templates virales disponibles" },
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("templates")
        .select("id, name, tags, slide_count, structure")
        .eq("user_id", USER_ID);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "list_carousels",
    { description: "Lista los carruseles del usuario" },
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("carousels")
        .select("id, title, slide_count, status, created_at, brand_id")
        .eq("user_id", USER_ID)
        .order("created_at", { ascending: false });
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_carousel",
    {
      description: "Trae un carrusel completo con todas sus slides",
      inputSchema: z.object({
        carouselId: z.string().describe("ID del carrusel"),
      }),
    },
    async ({ carouselId }) => {
      const supabase = getSupabase();
      const { data: carousel, error: cErr } = await supabase
        .from("carousels")
        .select("*")
        .eq("id", carouselId)
        .eq("user_id", USER_ID)
        .single();
      if (cErr || !carousel) return { content: [{ type: "text", text: "Carrusel no encontrado" }], isError: true };

      const { data: slides } = await supabase
        .from("slides")
        .select("*")
        .eq("carousel_id", carouselId)
        .order("index");

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ carousel, slides }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    "create_carousel",
    {
      description: "Crea un nuevo carrusel y guarda las slides, caption y hashtags",
      inputSchema: z.object({
        title: z.string(),
        prompt: z.string(),
        brandId: z.string().optional(),
        templateId: z.string().optional(),
        caption: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
        slides: z.array(
          z.object({
            title: z.string(),
            body: z.string(),
            kind: z.enum(["portada", "contenido", "cierre"]).optional(),
            visual: z.string().optional(),
          })
        ),
      }),
    },
    async ({ title, prompt, brandId, templateId, caption, hashtags, slides }) => {
      const supabase = getSupabase();

      const settings: any = {};
      if (caption) settings.caption = caption;
      if (hashtags) settings.hashtags = hashtags;

      const { data: carousel, error: cError } = await supabase
        .from("carousels")
        .insert({
          user_id: USER_ID,
          brand_id: brandId || null,
          template_id: templateId || null,
          title,
          prompt,
          engine: "claude",
          slide_count: slides.length,
          status: "done",
          settings,
        })
        .select()
        .single();

      if (cError || !carousel) {
        return { content: [{ type: "text", text: `Error: ${cError?.message}` }], isError: true };
      }

      const slidesData = slides.map((s, i) => ({
        carousel_id: carousel.id,
        index: i,
        kind: s.kind || (i === 0 ? "portada" : i === slides.length - 1 ? "cierre" : "contenido"),
        title: s.title,
        body: s.body,
        spec: s.visual ? { visual: s.visual } : {},
      }));

      const { error: sError } = await supabase.from("slides").insert(slidesData);
      if (sError) {
        return { content: [{ type: "text", text: `Error slides: ${sError.message}` }], isError: true };
      }

      return {
        content: [{
          type: "text",
          text: `Carrusel creado.\nID: ${carousel.id}\nTítulo: ${title}\nSlides: ${slides.length}\nURL: https://carrusely-maf1978s-projects.vercel.app/carrusel/${carousel.id}`,
        }],
      };
    }
  );

  server.registerTool(
    "update_slide",
    {
      description: "Actualiza el título o body de una slide existente",
      inputSchema: z.object({
        slideId: z.string(),
        title: z.string().optional(),
        body: z.string().optional(),
      }),
    },
    async ({ slideId, title, body }) => {
      const supabase = getSupabase();
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (body !== undefined) updates.body = body;

      const { data, error } = await supabase
        .from("slides")
        .update(updates)
        .eq("id", slideId)
        .select()
        .single();

      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      return { content: [{ type: "text", text: `Slide actualizada: ${JSON.stringify(data)}` }] };
    }
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(request: Request, env: any, ctx: any) {
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
    return handler(request, env, ctx);
  },
};
