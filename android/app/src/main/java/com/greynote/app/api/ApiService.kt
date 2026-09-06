package com.greynote.app.api

import com.greynote.app.api.model.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    @POST("api/login")
    suspend fun login(@Body req: LoginRequest): Response<Unit>

    @POST("api/logout")
    suspend fun logout(): Response<Unit>

    @GET("api/me")
    suspend fun me(): Response<MeResponse>

    @GET("api/notes")
    suspend fun listNotes(): Response<List<Note>>

    @POST("api/notes")
    suspend fun createNote(@Body req: NoteUpsertRequest): Response<CreateNoteResponse>

    @GET("api/notes/{id}")
    suspend fun getNote(@Path("id") id: Long): Response<Note>

    // If-Match carries the note version the client loaded, so the server can
    // reject a save that would overwrite a newer one from another device.
    @PUT("api/notes/{id}")
    suspend fun updateNote(
        @Path("id") id: Long,
        @Body req: NoteUpsertRequest,
        @Header("If-Match") ifMatch: String? = null,
    ): Response<UpdateNoteResponse>

    @DELETE("api/notes/{id}")
    suspend fun deleteNote(@Path("id") id: Long): Response<Unit>

    @POST("api/notes/{id}/pin")
    suspend fun togglePin(@Path("id") id: Long): Response<PinResponse>
}
