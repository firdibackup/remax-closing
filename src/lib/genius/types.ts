// Bentuk respons Genius yang dipakai aplikasi (sumber: OpenAPI remax-api-dev dan PLAN.md §3.3).
// Hanya field yang dipakai; field lain diabaikan. Tidak ada data pribadi (NIK/email/telepon) yang disimpan.

export type GeniusEnvelope<T> = {
  code: number;
  message: string;
  payload: T;
};

export type GeniusPaged<T> = {
  count: number;
  next: string | null;
  prev: string | null;
  results: T[];
};

export type GeniusOfficeRef = {
  officeId: string;
  officeName: string;
  officeCode: string;
};

export type GeniusAgentRef = {
  employeeCode: string | null;
  name: string | null;
  nickName?: string | null;
};

export type GeniusOfficeFee = {
  name: string;
  value: number;
  ppn: number;
  pph: number;
  realValue: number;
  amount: number;
};

// Satu orang dalam closing (listing/selling/co-listing/co-selling).
export type GeniusClosingPerson = {
  type: "INTERNAL" | "EXTERNAL";
  office: GeniusOfficeRef | null;
  agent: GeniusAgentRef | null;
  commissionAmount: number | string;
  officeFees?: GeniusOfficeFee[];
  payableToRemaxHQ?: number;
};

export type GeniusInvoice = {
  invoiceId: string;
  closingId: string;
  invoiceNumber: string;
  phase: number;
  totalPhase: number;
  percentage: number;
  amount: number | string;
  status: "PAID" | "UNPAID" | string;
  paidAt: string | null;
  dueDate: string | null;
  canceledAt: string | null;
};

// GET /employees?search=<employeeCode>: hanya field foto & nama yang dipakai (poster Top MA).
export type GeniusEmployee = {
  employeeId: string;
  employeeCode: string | null;
  status: string;
  user: { name: string | null; nickName: string | null; profilePic: string | null } | null;
};

export type GeniusClosing = {
  closingId: string;
  closingCode: string;
  closingDate: string;
  closingType: string;
  paymentType: "CASH" | "KPR" | string;
  bankKPRName?: string | null;
  dppAmount: number | string;
  dppPercentage: number | string;
  commissionType: "FULL" | "PARTIAL" | string;
  status: string;
  closingData?: {
    listingPerson: GeniusClosingPerson | null;
    sellingPerson: GeniusClosingPerson | null;
    coListingPersons: GeniusClosingPerson[];
    coSellingPersons: GeniusClosingPerson[];
  };
  sellingPrice?: number | string | null;
  listingMetadata?: {
    title?: string | null;
    sellOrRent?: string | null;
    listingType?: string | null;
    listingPart?: { name?: string | null } | null;
  } | null;
  invoice?: GeniusInvoice[];
};
