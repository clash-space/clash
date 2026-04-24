import { Link } from "react-router";

export default function PrivacyRoute() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
        ← Back
      </Link>
      <h1 className="mt-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-4 text-gray-600">
        Placeholder. Replace with actual policy before launch.
      </p>
    </div>
  );
}
