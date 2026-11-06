import { redirect } from "next/navigation";

export default function PeopleIndex() {
  redirect("/app/people/owners");
}
