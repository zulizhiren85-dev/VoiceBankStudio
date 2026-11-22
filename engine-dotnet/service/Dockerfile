# Build the pinned OpenUtau Core/Builtin source with the engine service.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG OPENUTAU_COMMIT=08222cb7c48c4ab47faa34a6efc34e2c00898a1e
WORKDIR /src
RUN git clone https://github.com/openutau/OpenUtau.git /src/OpenUtau \
    && git -C /src/OpenUtau checkout "$OPENUTAU_COMMIT" \
    && test "$(git -C /src/OpenUtau rev-parse HEAD)" = "$OPENUTAU_COMMIT"
WORKDIR /src/VoiceBankStudio
COPY . .
RUN dotnet publish engine-dotnet/service/VoiceBankStudio.Service.csproj \
    --configuration Release \
    --output /app/publish \
    -p:OpenUtauSourcePath=/src/OpenUtau

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ENV ASPNETCORE_URLS=http://0.0.0.0:10000
ENV ASPNETCORE_HTTP_PORTS=10000
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 10000
ENTRYPOINT ["dotnet", "VoiceBankStudio.Service.dll"]
