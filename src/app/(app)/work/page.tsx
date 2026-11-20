import { Suspense } from "react";

import { ReviewQueue } from "@/components/work/review-queue";

export default function WorkPage() {
  return (
    <Suspense
      fallback={
        <section className="ano-section-page">
          <p>Loading work queue…</p>
        </section>
      }
    >
      <ReviewQueue />
    </Suspense>
  );
}
