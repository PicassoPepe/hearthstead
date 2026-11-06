"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { signupAction } from "@/server/actions/auth";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  orgName: z.string().trim().min(2, "Enter your company name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
});
type Values = z.infer<typeof schema>;

export function SignupForm() {
  const [serverError, setServerError] = React.useState<string>();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", orgName: "", email: "", password: "" } });
  const e = form.formState.errors;
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-muted-foreground">Set up your company workspace in under a minute.</p>
      {serverError ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{serverError}</div>
      ) : null}
      <Card className="mt-6">
        <CardContent className="pt-5">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(async (v) => {
              setServerError(undefined);
              const r = await signupAction(v);
              if (r && !r.ok) {
                setServerError(r.error);
                for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) form.setError(k as keyof Values, { message: msg });
              }
            })}
          >
            <Field label="Your name" error={e.name?.message} required>
              {(a) => <Input autoComplete="name" {...a} {...form.register("name")} />}
            </Field>
            <Field label="Company name" error={e.orgName?.message} required>
              {(a) => <Input autoComplete="organization" {...a} {...form.register("orgName")} />}
            </Field>
            <Field label="Work email" error={e.email?.message} required>
              {(a) => <Input type="email" autoComplete="email" {...a} {...form.register("email")} />}
            </Field>
            <Field label="Password" description="At least 10 characters." error={e.password?.message} required>
              {(a) => <Input type="password" autoComplete="new-password" {...a} {...form.register("password")} />}
            </Field>
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>Create workspace</Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
