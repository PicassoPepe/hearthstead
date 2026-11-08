-- AddForeignKey
ALTER TABLE "ParcelRecord" ADD CONSTRAINT "ParcelRecord_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
