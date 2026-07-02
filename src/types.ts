import type { Timestamp } from 'firebase/firestore';

export type CriteriaKey = 'space' | 'winterTraction' | 'valueMSRP' | 'reliability' | 'fuelEfficiency' | 'safetyTech' | 'comfort';
export type Drivetrain = 'AWD' | 'FWD' | '4WD';
export type Powertrain = 'Gas' | 'Hybrid' | 'Plug-in Hybrid' | 'Electric';
export type BodyStyle = 'Compact SUV' | 'Midsize SUV' | 'Wagon';
export type ProfileName = 'Emily' | 'Nick';
export type VehicleStage = 'Browsing' | 'Shortlisted' | 'Test drive booked' | 'Test driven' | 'Quote received' | 'Finalist' | 'Rejected' | 'Winner';
export type UserReaction = 'Love' | 'Maybe' | 'No' | 'Unrated';
export type TestDriveStatus = 'Planned' | 'Completed';

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
  updatedAt?: Timestamp;
  updatedByUid?: string;
  updatedByProfile?: ProfileName;
  version?: number;
}

export interface VehicleNoteDocument {
  vehicleId: string;
  sharedNote: string;
  stage: VehicleStage;
  reactions: Record<ProfileName, UserReaction>;
  updatedAt?: Timestamp;
}

export interface DealQuoteDocument {
  id?: string;
  vehicleId: string;
  dealer: string;
  trim: string;
  price: number;
  discount: number;
  fees: number;
  accessories: number;
  tradeIn: number;
  financeRate: number;
  leaseRate: number;
  expiryDate: string;
  contact: string;
  listingUrl: string;
  usedYear?: number;
  mileageKm?: number;
  accidentHistory?: string;
  cpo?: boolean;
  inspectionNotes?: string;
  createdAt?: Timestamp;
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
  hasHeatedRearSeats?: boolean;
  hasMemorySeats?: boolean;
  hasSpareTire?: boolean;
  hasCvt?: boolean;
  physicalClimateControls?: boolean;
}

export interface ScoredVehicle extends VehicleReference {
  familyCompatibilityScore: number;
  confidenceScore: number;
  testDriveScore: number;
  dealScore: number;
  overallRecommendationScore: number;
}

export interface TestDriveEntry {
  id?: string;
  vehicleId: string;
  date: string;
  appointmentTime: string;
  reminderDate: string;
  dealer: string;
  notes: string;
  carSeatFits: boolean;
  strollerFits: boolean;
  doorsOpen90: boolean;
  passengerLegroom: boolean;
  cargoFloorWorks: boolean;
  winterTireQuote: boolean;
  outTheDoorQuote: boolean;
  prepaymentRules: boolean;
  winterConfidence: number;
  partnerRating: number;
  photoUrls?: string[];
  status?: TestDriveStatus;
  createdAt?: Timestamp;
}
