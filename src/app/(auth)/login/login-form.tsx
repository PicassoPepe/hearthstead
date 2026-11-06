"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loginWithPassword, requestMagicLink } from "@/server/actions/auth";

const pwSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
const linkSchema = z.object({ email: z.email("Enter a valid email") });

export function LoginForm({ defaultEmail, invited, callbackUrl, error }: { defaultEmail: string; invited: boolean; callbackUrl: string; error?: string }) {
  const [serverError, setServerError] = React.useState<string | undefined>(error);
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { email: defaultEmail, password: "" } });
  const link = useForm<z.infer<typeof linkSchema>>({ resolver: zodResolver(linkSchema), defaultValues: { email: defaultEmail } });

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{invited ? "Accept your invitation" : "Welcome back"}</h1>
      <p className="mt-1 text-muted-foreground">
        {invited ? "Sign in with an email link to join your team." : "Sign in to manage your properties."}
      </p>

      {serverError ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
          {serverError}
        </div>
      ) : null}

      <Card className="mt-6">
        <CardContent className="pt-5">
          <Tabs defaultValue={invited ? "link" : "password"}>
            <TabsList className="mb-5" aria-label="Sign-in method">
              <TabsTrigger value="password"><KeyRound className="mr-1.5 inline size-4" aria-hidden />Password</TabsTrigger>
              <TabsTrigger value="link"><Mail className="mr-1.5 inline size-4" aria-hidden />Email link</TabsTrigger>
            </TabsList>

            <TabsContent value="password">
              <form
                noValidate
                className="grid gap-4"
                onSubmit={pw.handleSubmit(async (v) => {
                  setServerError(undefined);
                  const r = await loginWithPassword(v, callbackUrl);
                  if (r && !r.ok) setServerError(r.error);
                })}
              >
                <Field label="Email" error={pw.formState.errors.email?.message} required>
                  {(a) => <Input type="email" autoComplete="email" {...a} {...pw.register("email")} />}
                </Field>
                <Field label="Password" error={pw.formState.errors.password?.message} required>
                  {(a) => <Input type="password" autoComplete="current-password" {...a} {...pw.register("password")} />}
                </Field>
                <Button type="submit" size="lg" loading={pw.formState.isSubmitting}>Sign in</Button>
              </form>
            </TabsContent>

            <TabsContent value="link">
              <form
                noValidate
                className="grid gap-4"
                onSubmit={link.handleSubmit(async (v) => {
                  setServerError(undefined);
                  const r = await requestMagicLink(v, callbackUrl);
                  if (r && !r.ok) setServerError(r.error);
                })}
              >
                <Field label="Email" description="We'll email you a one-time sign-in link." error={link.formState.errors.email?.message} required>
                  {(a) => <Input type="email" autoComplete="email" {...a} {...link.register("email")} />}
                </Field>
                <Button type="submit" size="lg" loading={link.formState.isSubmitting}>Email me a link</Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Hearthstead?{" "}
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">Create an account</Link>
      </p>
    </div>
  );
}
