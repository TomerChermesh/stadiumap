import { GoogleGenAI, Type, Schema } from "@google/genai";
import { AIInsight, Stadium, Coordinates } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Fetches rich descriptions and fun facts about a stadium using Gemini.
 */
export const fetchStadiumInsights = async (stadium: Stadium): Promise<AIInsight> => {
  try {
    const prompt = `
      Provide a short, engaging description (max 50 words) and one unique, interesting fun fact about the football stadium "${stadium.name}" located in ${stadium.city}.
      The description should mention its historical significance or atmosphere.
      The fun fact should be surprising.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description: "A short engaging description of the stadium."
            },
            funFact: {
              type: Type.STRING,
              description: "A unique fun fact about the stadium."
            }
          },
          required: ["description", "funFact"]
        }
      }
    });

    const text = response.text;
    if (!text) {
        throw new Error("Empty response from AI");
    }
    return JSON.parse(text) as AIInsight;

  } catch (error) {
    console.error("Error fetching stadium insights:", error);
    return {
      description: "A legendary football ground.",
      funFact: "Home to amazing matches throughout history."
    };
  }
};

/**
 * Fetches a list of stadiums within a specific geographic bounding box.
 */
export const fetchStadiumsInArea = async (bounds: { north: number, south: number, east: number, west: number }): Promise<Stadium[]> => {
  try {
    // Construct a prompt that asks for stadiums strictly within the view
    const prompt = `
      List up to 15 major professional football (soccer) stadiums located STRICTLY within this geographic bounding box:
      North Lat: ${bounds.north}, South Lat: ${bounds.south}, East Lng: ${bounds.east}, West Lng: ${bounds.west}.
      
      Focus on top-tier league stadiums, national stadiums, or historically significant grounds.
      Do NOT invent stadiums. If fewer than 15 exist in this exact box, return only the real ones.
      
      Ensure coordinates are as precise as possible.
      The 'id' should be a kebab-case string of the stadium name (e.g., 'camp-nou').
    `;

    const stadiumSchema: Schema = {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            commonName: { type: Type.STRING, nullable: true },
            city: { type: Type.STRING },
            country: { type: Type.STRING },
            capacity: { type: Type.NUMBER },
            homeTeams: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING } 
            },
            coordinates: {
                type: Type.OBJECT,
                properties: {
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER }
                },
                required: ["lat", "lng"]
            },
            imageUrl: { type: Type.STRING, description: "A generic placeholder URL if real one not known, or leave empty." }
        },
        required: ["id", "name", "city", "country", "capacity", "homeTeams", "coordinates"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.ARRAY,
            items: stadiumSchema
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    const stadiums = JSON.parse(text) as Stadium[];
    
    // Post-process to add placeholder images if missing
    return stadiums.map(s => ({
        ...s,
        imageUrl: s.imageUrl || `https://picsum.photos/800/400?random=${Math.floor(Math.random() * 1000)}`
    }));

  } catch (error) {
    console.error("Error scanning area for stadiums:", error);
    return [];
  }
};