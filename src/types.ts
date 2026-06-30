import type { Timestamp } from 'firebase/firestore';

export type CriteriaKey = 'space' | 'winterTraction' | 'valueMSRP' | 'reliability' | 'fuelEfficiency' | 'safetyTech' | 'comfort';
export type Drivetrain = 'AWD' | 'FWD' | '4WD';
export type Powertrain = 'Gas' | 'Hybrid' | 'Plug-in Hybrid' | 'Electric';
export type BodyStyle = 'Compact SUV' | 'Midsize SUV' | 'Wagon';

export interface CriteriaWeights {
  space: number;
  winterTraction: number;
  valueMSRP: number;
  reliability: number;
  fuelEfficiency: number;
  safetyTech: number;
  comfort: number;
}

export interface SessionDocument {
  id: string;
  dynamicShareLink: string;
  createdAt: Timestamp;
  partnerIds: string[];
  vehiclesShortlist: string[];
}

export interface UserPreferenceDocument {
  userId: string;
  criteriaWeights: CriteriaWeights;
  personalNotes: Record<string, string>;
  favoriteVehicleIds?: string[];
}

export interface TestDriveDocument {
  vehicleId: string;
  physicalChecklist: {
    carSeatFits: boolean;
    doorsOpen90: boolean;
    strollerFits: boolean;
  };
  thumbsUpCount: number;
  uploadedPhotos: string[];
}

export interface VehicleReference {
  id: string;
  make: string;
  model: string;
  name: string;
  year: number;
  bodyStyle: BodyStyle;
  msrp: number;
  drivetrain: Drivetrain;
  powertrain: Powertrain;
  seats: number;
  cargoLitres: number;
  fuelEfficiency: string;
  towingKg?: number;
  spaceScore: number;
  winterScore: number;
  valueScore: number;
  reliabilityScore: number;
  efficiencyScore: number;
  safetyScore: number;
  comfortScore: number;
  highlights: string[];
  tradeoffs: string[];
  manufacturerUrl: string;
  imageUrl?: string;
  photoCredit: string;
}

export interface ScoredVehicle extends VehicleReference {
  familyCompatibilityScore: number;
}

export interface TestDriveEntry {
  vehicleId: string;
  date: string;
  dealer: string;
  notes: string;
  carSeatFits: boolean;
  strollerFits: boolean;
  winterConfidence: number;
  partnerRating: number;
}
