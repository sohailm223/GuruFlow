export default function StepCard({ step }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between">
        <div>
          <p className="text-sm text-gray-500">Step {step.stepNumber}</p>
          <h3 className="font-semibold">{step.title}</h3>
          {step.previewLink && (
            <a
              href={step.previewLink}
              target="_blank"
              className="text-blue-600 text-sm"
            >
              View Preview →
            </a>
          )}
        </div>

        <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700">
          {step.stepstatus}
        </span>
      </div>

      {step.approvedAt && (
        <p className="text-sm text-green-600 mt-2">
          Approved on {new Date(step.approvedAt).toDateString()}
        </p>
      )}

      {step.rejectionReason && (
        <p className="text-sm text-red-600 mt-2">
          Rejected: {step.rejectionReason.raw.children[0].text}
        </p>
      )}
    </div>
  );
}
