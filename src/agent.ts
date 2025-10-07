import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  metrics,
  voice,
} from '@livekit/agents';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: '.env.local' });

class Assistant extends voice.Agent {
  constructor() {
    super({
      instructions: `Vous êtes un assistant vocal médical français. Vous interagissez avec l'utilisateur via la voix, même si vous percevez la conversation comme du texte.
      Vous assistez les utilisateurs avec leurs questions médicales en fournissant des informations de vos connaissances étendues.
      Vos réponses sont concises, précises et sans formatage complexe ou ponctuation incluant emojis, astérisques ou autres symboles.
      Vous êtes curieux, amical et avez un sens de l'humour. Vous répondez toujours en français.`,

      // To add tools, specify `tools` in the constructor.
      // Here's an example that adds a simple weather tool.
      // You also have to add `import { llm } from '@livekit/agents' and `import { z } from 'zod'` to the top of this file
      // tools: {
      //   getWeather: llm.tool({
      //     description: `Use this tool to look up current weather information in the given location.
      //
      //     If the location is not supported by the weather service, the tool will indicate this. You must tell the user the location's weather is unavailable.`,
      //     parameters: z.object({
      //       location: z
      //         .string()
      //         .describe('The location to look up weather information for (e.g. city name)'),
      //     }),
      //     execute: async ({ location }) => {
      //       console.log(`Looking up weather for ${location}`);
      //
      //       return 'sunny with a temperature of 70 degrees.';
      //     },
      //   }),
      // },
    });
  }
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    // Configuration du pipeline vocal avec Deepgram FR Medical, OpenAI GPT-4o Mini, et ElevenLabs
    const session = new voice.AgentSession({
      // Speech-to-text (STT) - Deepgram français médical
      // Voir tous les modèles disponibles sur https://docs.livekit.io/agents/models/stt/
      stt: 'deepgram/nova-2-fr-medical',

      // Large Language Model (LLM) - OpenAI GPT-4o Mini
      // Voir tous les fournisseurs sur https://docs.livekit.io/agents/models/llm/
      llm: 'openai/gpt-4o-mini',

      // Text-to-speech (TTS) - ElevenLabs
      // Voir tous les modèles disponibles et sélections de voix sur https://docs.livekit.io/agents/models/tts/
      tts: 'elevenlabs/multilingual',

      // VAD et détection de tours pour déterminer quand l'utilisateur parle et quand l'agent doit répondre
      // Voir plus sur https://docs.livekit.io/agents/build/turns
      turnDetection: new livekit.turnDetector.MultilingualModel(),
      vad: ctx.proc.userData.vad! as silero.VAD,
    });

    // To use a realtime model instead of a voice pipeline, use the following session setup instead.
    // (Note: This is for the OpenAI Realtime API. For other providers, see https://docs.livekit.io/agents/models/realtime/))
    // 1. Install '@livekit/agents-plugin-openai'
    // 2. Set OPENAI_API_KEY in .env.local
    // 3. Add import `import * as openai from '@livekit/agents-plugin-openai'` to the top of this file
    // 4. Use the following session setup instead of the version above
    // const session = new voice.AgentSession({
    //   llm: new openai.realtime.RealtimeModel({ voice: 'marin' }),
    // });

    // Collecte de métriques pour mesurer les performances du pipeline
    // Pour plus d'informations, voir https://docs.livekit.io/agents/build/metrics/
    const usageCollector = new metrics.UsageCollector();
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics);
      usageCollector.collect(ev.metrics);
    });

    const logUsage = async () => {
      const summary = usageCollector.getSummary();
      console.log(`Usage: ${JSON.stringify(summary)}`);
    };

    ctx.addShutdownCallback(logUsage);

    // Démarrer la session, qui initialise le pipeline vocal et préchauffe les modèles
    await session.start({
      agent: new Assistant(),
      room: ctx.room,
      inputOptions: {
        // Annulation de bruit améliorée LiveKit Cloud
        // - Si auto-hébergement, omettre ce paramètre
        // - Pour les applications téléphoniques, utiliser `BackgroundVoiceCancellationTelephony` pour de meilleurs résultats
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    // Rejoindre la room et se connecter à l'utilisateur
    await ctx.connect();
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
