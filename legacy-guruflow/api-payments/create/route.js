import { NextResponse } from "next/server";
import { hygraph } from "@/lib/hygraph";

export async function POST(req) {
  try {
    const formData = await req.formData();

    const projectId = formData.get("projectId");
    const clientId = formData.get("clientId");
    const amount = parseFloat(formData.get("amount"));
    const receivedDate = formData.get("receivedDate");
    const notes = formData.get("notes");

    if (!projectId || !amount || !receivedDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const mutation = `
      mutation CreatePayment(
        $amount: Float!
        $receivedDate: Date!
        $notes: String
        $projectId: ID!
        $clientId: ID
      ) {
        createPayment(
          data: {
            amount: $amount
            receivedDate: $receivedDate
            notes: $notes
            projectAssign: { connect: { id: $projectId } }
            assignClient: { connect: { id: $clientId } }
          }
        ) {
          id
        }
      }
    `;

    const variables = {
      amount,
      receivedDate,
      notes,
      projectId,
      clientId,
    };

    const result = await hygraph.request(mutation, variables);

    return NextResponse.json({
      success: true,
      paymentId: result.createPayment.id,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Payment creation failed" },
      { status: 500 }
    );
  }
}
