import type { Timestamp } from 'firebase/firestore';

export type CriteriaKey = 'space' | 'winterTraction' | 'valueMSRP';

export interface CriteriaWeights {
  space: number;
  winterTraction: number;
  valueMSRP: number;
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
  name: string;
  msrp: number;
  spaceScore: number;
  winterScore: number;
  valueScore: number;
}

export interface ScoredVehicle extends VehicleReference {
  familyCompatibilityScore: number;
}
