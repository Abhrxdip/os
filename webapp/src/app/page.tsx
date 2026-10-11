import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">
          SelfOS
        </h1>
        <p className="text-lg text-muted-foreground">
          Your AI-powered personal operating system with a centralized memory layer.
          SelfOS knows your skills, preferences, and projects — and collaborates
          across AI clients and with friends' agents.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
