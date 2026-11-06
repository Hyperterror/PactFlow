import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { NewBriefForm } from "./new-brief-form";

export const metadata: Metadata = { title: "New brief" };

export default function NewBriefPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Step 1 of 4"
        title="Write the brief"
        description="Everything downstream — the quotations, the comparison, the agreement, the delivery checklist — is derived from this document."
      />
      <NewBriefForm />
    </div>
  );
}
