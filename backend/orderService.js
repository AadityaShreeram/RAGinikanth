import fetch from "node-fetch";

export async function getOrderById(orderId) {
  try {
    const res = await fetch(`https://68db9868445fdb39dc25ee28.mockapi.io/orderItems/${orderId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching order:", err);
    return null;
  }
}
