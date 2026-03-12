import StepCard from "./StepCard";

export default function TimelineView({ timeline }) {
  const steps = Array.isArray(timeline?.steps)
    ? [...timeline.steps].sort((a, b) => a.stepNumber - b.stepNumber)
    : [];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">
        {timeline?.title || "Timeline"}
      </h2>

      <div className="space-y-4">
        {steps.map((step, idx) => (
          <StepCard
            key={step?.stepNumber ?? idx}
            step={step}
          />
        ))}
      </div>
    </div>
  );
}
