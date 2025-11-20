export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Stadium {
  id: string;
  name: string;
  commonName?: string;
  city: string;
  country: string;
  capacity: number;
  homeTeams: string[];
  coordinates: Coordinates;
  imageUrl?: string;
  description?: string; // AI Generated content
  funFact?: string; // AI Generated content
}

export interface UserState {
  visitedStadiumIds: string[];
}

export interface AIInsight {
  description: string;
  funFact: string;
}
