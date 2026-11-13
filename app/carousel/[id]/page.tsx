"use client";
import { useParams } from "next/navigation";
import CarouselEditor from "../CarouselEditor";

export default function CarouselPage() {
  const { id } = useParams<{ id: string }>();
  return <CarouselEditor id={id} />;
}
