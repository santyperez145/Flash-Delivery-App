import { request } from "./api";
import type { FamilyMember, FamilyProfile } from "./types";

// Perfil familiar (PAG-05), aparte de `api.ts` porque ese archivo es un monolito
// identificado en el hallazgo H-08. Mismas llamadas en web y app.

export const getFamilyProfile = () => request<{ family: FamilyProfile }>("/me/family");

/** `monthlyLimit` en pesos enteros; `null` es sin tope. Con dos pasos activos, `mfaCode`. */
export const inviteFamilyMember = (input: {
  email: string;
  monthlyLimit: number | null;
  mfaCode?: string;
}) =>
  request<{ member: FamilyMember }>("/family/members", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const setFamilyMemberLimit = (
  memberId: string,
  input: { monthlyLimit: number | null; mfaCode?: string },
) =>
  request<{ member: { id: string; monthlyLimit: number | null } }>(`/family/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const removeFamilyMember = (memberId: string) =>
  request<{ member: { id: string; status: string } }>(`/family/members/${memberId}`, {
    method: "DELETE",
  });

export const respondFamilyInvitation = (memberId: string, accept: boolean) =>
  request<{ member: { id: string; status: string } }>(
    `/family/invitations/${memberId}/${accept ? "accept" : "decline"}`,
    { method: "POST", body: "{}" },
  );

export const leaveFamilyProfile = () =>
  request<{ member: { id: string; status: string } }>("/family/leave", {
    method: "POST",
    body: "{}",
  });

/** El comprobante de un servicio que se pagó con el perfil: quien pagó también lo lee. */
export const getFamilyChargeReceipt = (jobId: string) =>
  request<{
    receipt: {
      id: string;
      number: string;
      jobId: string;
      total: number;
      issuedAt: string;
      payment: { familyProfile?: boolean; status?: string };
    };
  }>(`/jobs/${jobId}/receipt`);
